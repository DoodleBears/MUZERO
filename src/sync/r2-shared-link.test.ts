import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { connectReadOnlyManifest } from "./r2-shared-link";

const manifest = {
  schema: "muzero-r2-manifest-v1",
  libraryId: "lib_demo",
  title: "Demo Library",
  baseUrl: "https://music.example.com/muzero/",
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
  sets: [
    {
      id: "set_1",
      title: "Night Drive",
      index: "sets/set_1/index.json",
      updatedAt: "2026-06-09T00:00:00.000Z",
      trackCount: 3,
      bytes: 4096,
    },
  ],
};

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-r2-shared-link-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("connectReadOnlyManifest", () => {
  it("registers a shared R2 drive only after the manifest validates", async () => {
    const connection = await connectReadOnlyManifest(
      "https://music.example.com/muzero/manifest.json",
      {
        fetcher: async () => Response.json(manifest),
      },
      db,
    );

    expect(connection).toMatchObject({
      driveId: "drv_lib_demo",
      shareId: "shr_lib_demo",
      preview: {
        libraryId: "lib_demo",
        title: "Demo Library",
      },
    });
    expect(await db.cloudDrives.get("drv_lib_demo")).toMatchObject({
      id: "drv_lib_demo",
      kind: "shared",
      provider: "r2",
      publicBaseUrl: "https://music.example.com/muzero/",
      manifestUrl: "https://music.example.com/muzero/manifest.json",
      capabilities: {
        read: true,
        write: false,
        manageInvites: false,
        writeStats: false,
        writePresence: false,
      },
    });
    expect(await db.cloudShares.get("shr_lib_demo")).toMatchObject({
      id: "shr_lib_demo",
      driveId: "drv_lib_demo",
      remoteShareId: "lib_demo",
      access: "read-only",
    });
  });

  it("does not mutate local IndexedDB when the manifest is invalid", async () => {
    await expect(
      connectReadOnlyManifest(
        "https://music.example.com/muzero/manifest.json",
        {
          fetcher: async () => Response.json({ schema: "wrong" }),
        },
        db,
      ),
    ).rejects.toThrow(/invalid manifest/i);

    expect(await db.cloudDrives.count()).toBe(0);
    expect(await db.cloudShares.count()).toBe(0);
  });

  it("does not mutate local IndexedDB when the manifest cannot be fetched", async () => {
    await expect(
      connectReadOnlyManifest(
        "https://music.example.com/muzero/manifest.json",
        {
          fetcher: async () => new Response("missing", { status: 404 }),
        },
        db,
      ),
    ).rejects.toThrow(/failed to fetch manifest/i);

    expect(await db.cloudDrives.count()).toBe(0);
    expect(await db.cloudShares.count()).toBe(0);
  });
});
