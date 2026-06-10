import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { buildR2ExportPlan } from "./r2-export-plan";
import { entityCoverRemoteWins, importRemoteEntityCovers } from "./r2-import-stream";
import type { R2EntityCoversIndex } from "./r2-manifest-schema";
import { r2EntityCoversIndexSchema, r2ManifestSchema } from "./r2-manifest-schema";

const BASE = "https://music.example.com/muzero/";

function remoteIndex(
  entries: R2EntityCoversIndex["entries"],
  updatedAt = 1000,
): R2EntityCoversIndex {
  return { schema: "muzero-r2-entity-covers-v1", updatedAt, entries };
}

function remoteEntry(id: string, updatedAt: number, kind: "artist" | "album" = "artist") {
  return {
    id,
    kind,
    cover: {
      url: `objects/covers/sha256-${id}.jpg`,
      mime: "image/jpeg",
      bytes: 10,
      sha256: id,
    },
    updatedAt,
  };
}

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-entity-cover-sync-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

async function seedEntityCover(
  id: string,
  kind: "artist" | "album",
  blobId: string,
  updatedAt = 1000,
) {
  await db.mediaBlobs.put({
    id: blobId,
    trackId: id,
    role: "cover",
    mime: "image/jpeg",
    bytes: 1234,
    blob: new Blob(["cover-bytes"], { type: "image/jpeg" }),
  });
  await db.entityCovers.put({ id, kind, coverBlobId: blobId, updatedAt });
}

const EXPORT_INPUT = {
  driveId: "drv_1",
  libraryId: "lib_1",
  baseUrl: "https://music.example.com/muzero/",
  setIds: [] as string[],
};

describe("entity-cover R2 schema", () => {
  it("parses a library entity-covers index", () => {
    const index = r2EntityCoversIndexSchema.parse({
      schema: "muzero-r2-entity-covers-v1",
      updatedAt: 1000,
      entries: [
        {
          id: "double j 姜峰",
          kind: "artist",
          cover: {
            url: "objects/covers/sha256-abc.jpg",
            mime: "image/jpeg",
            bytes: 10,
            sha256: "abc",
          },
          crop: { x: 1, y: 2, width: 3, height: 4 },
          updatedAt: 1000,
        },
      ],
    });
    expect(index.entries[0]?.kind).toBe("artist");
  });

  it("accepts an optional entityCoversIndex on the manifest", () => {
    const manifest = r2ManifestSchema.parse({
      schema: "muzero-r2-manifest-v1",
      libraryId: "lib_1",
      title: "MUZERO Library",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
      baseUrl: "https://music.example.com/muzero/",
      sets: [],
      entityCoversIndex: "library/entity-covers/index.json",
    });
    expect(manifest.entityCoversIndex).toBe("library/entity-covers/index.json");
  });
});

describe("buildR2ExportPlan — entity covers", () => {
  it("exports content-addressed bytes + a library index and links the manifest", async () => {
    await seedEntityCover("taylor swift", "artist", "blb_a", 1500);
    await seedEntityCover("1989::taylor swift", "album", "blb_b", 1000);

    const plan = await buildR2ExportPlan({ ...EXPORT_INPUT, db });

    const kinds = plan.objects.map((o) => o.kind);
    expect(kinds).toContain("entity-cover");
    expect(kinds).toContain("entity-covers-index");

    const cover = plan.objects.find((o) => o.kind === "entity-cover");
    expect(cover?.key).toMatch(/^objects\/covers\/sha256-[a-f0-9]{64}\.jpg$/);

    const indexObj = plan.objects.find((o) => o.kind === "entity-covers-index");
    expect(indexObj?.key).toBe("library/entity-covers/index.json");
    const index = JSON.parse(String(indexObj?.body));
    expect(index.schema).toBe("muzero-r2-entity-covers-v1");
    expect(index.updatedAt).toBe(1500); // newest entry clock
    expect(index.entries.map((e: { id: string }) => e.id).sort()).toEqual([
      "1989::taylor swift",
      "taylor swift",
    ]);

    const manifest = JSON.parse(String(plan.objects.find((o) => o.kind === "manifest")?.body));
    expect(manifest.entityCoversIndex).toBe("library/entity-covers/index.json");
  });

  it("omits the index and manifest link when there are no entity covers", async () => {
    const plan = await buildR2ExportPlan({ ...EXPORT_INPUT, db });
    expect(plan.objects.map((o) => o.kind)).not.toContain("entity-covers-index");
    const manifest = JSON.parse(String(plan.objects.find((o) => o.kind === "manifest")?.body));
    expect(manifest.entityCoversIndex).toBeUndefined();
  });

  it("re-exports an imported (remote-backed) cover BY REFERENCE so a 2nd device can't drop it", async () => {
    await importRemoteEntityCovers(
      { baseUrl: BASE, index: remoteIndex([remoteEntry("a", 1000)]) },
      db,
    );

    const plan = await buildR2ExportPlan({ ...EXPORT_INPUT, db });
    const kinds = plan.objects.map((o) => o.kind);
    // No binary re-upload (bytes already live remotely), but the index still lists it.
    expect(kinds).not.toContain("entity-cover");
    expect(kinds).toContain("entity-covers-index");
    const index = JSON.parse(
      String(plan.objects.find((o) => o.kind === "entity-covers-index")?.body),
    );
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].cover.url).toBe("objects/covers/sha256-a.jpg");
  });
});

describe("entityCoverRemoteWins (last-write-wins)", () => {
  it("remote wins when there is no local cover or it is strictly newer", () => {
    expect(entityCoverRemoteWins(undefined, 100)).toBe(true);
    expect(entityCoverRemoteWins(100, 200)).toBe(true);
  });
  it("local wins on a newer or equal clock", () => {
    expect(entityCoverRemoteWins(200, 100)).toBe(false);
    expect(entityCoverRemoteWins(100, 100)).toBe(false);
  });
});

describe("importRemoteEntityCovers", () => {
  it("imports remote covers as remote-backed rows (resolved URL, no local blob)", async () => {
    const res = await importRemoteEntityCovers(
      { baseUrl: BASE, index: remoteIndex([remoteEntry("artist1", 1000)]) },
      db,
    );

    expect(res).toEqual({ imported: 1, skipped: 0 });
    const row = await db.entityCovers.get("artist1");
    expect(row?.coverBlobId).toBeUndefined();
    expect(row?.remoteCover?.url).toBe(`${BASE}objects/covers/sha256-artist1.jpg`);
    expect(row?.remoteCover?.key).toBe("objects/covers/sha256-artist1.jpg");
    expect(row?.updatedAt).toBe(1000);
  });

  it("carries the cover thumbhash onto the imported (remote-backed) row", async () => {
    await importRemoteEntityCovers(
      {
        baseUrl: BASE,
        index: remoteIndex([{ ...remoteEntry("artistTH", 1000), thumbhash: "TH64" }]),
      },
      db,
    );
    expect((await db.entityCovers.get("artistTH"))?.thumbhash).toBe("TH64");
  });

  it("keeps a strictly-newer local cover (LWW) and replaces an older one", async () => {
    await seedEntityCover("keep", "artist", "blb_keep", 5000); // local newer
    await seedEntityCover("replace", "artist", "blb_replace", 100); // local older

    const res = await importRemoteEntityCovers(
      {
        baseUrl: BASE,
        index: remoteIndex([remoteEntry("keep", 1000), remoteEntry("replace", 2000)]),
      },
      db,
    );

    expect(res).toEqual({ imported: 1, skipped: 1 });
    // kept local
    expect((await db.entityCovers.get("keep"))?.coverBlobId).toBe("blb_keep");
    // replaced with remote-backed; old local blob cleaned up
    const replaced = await db.entityCovers.get("replace");
    expect(replaced?.coverBlobId).toBeUndefined();
    expect(replaced?.remoteCover?.url).toBe(`${BASE}objects/covers/sha256-replace.jpg`);
    expect(await db.mediaBlobs.get("blb_replace")).toBeUndefined();
  });
});
