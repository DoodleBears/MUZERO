import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { DjSession, MediaBlob, Memory, Track } from "@/db/types";
import { buildR2ExportPlan } from "./r2-export-plan";

let db: MuzeroDB;
let dbName: string;

describe("buildR2ExportPlan", () => {
  beforeEach(() => {
    dbName = `muzero-r2-export-plan-${Math.random().toString(36).slice(2)}`;
    db = new MuzeroDB(dbName);
  });

  afterEach(async () => {
    db.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = req.onerror = () => resolve();
    });
  });

  it("plans media, covers, memory photos, set index, then root manifest", async () => {
    await seedSet();

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });

    expect(plan.objects.map((object) => object.kind)).toEqual([
      "media",
      "cover",
      "memory-photo",
      "set-index",
      "manifest",
    ]);
    expect(plan.objects.at(-1)).toMatchObject({
      kind: "manifest",
      key: "manifest.json",
      contentType: "application/json",
    });
    expect(plan.totalBytes).toBe(plan.objects.reduce((sum, object) => sum + object.bytes, 0));
  });

  it("uses content-addressed keys for binary media", async () => {
    await seedSet();

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });

    expect(plan.objects.find((object) => object.kind === "media")?.key).toMatch(
      /^objects\/media\/sha256-[a-f0-9]{64}\.mp3$/,
    );
    expect(plan.objects.find((object) => object.kind === "cover")?.key).toMatch(
      /^objects\/covers\/sha256-[a-f0-9]{64}\.jpg$/,
    );
    expect(plan.objects.find((object) => object.kind === "memory-photo")?.key).toMatch(
      /^objects\/memories\/sha256-[a-f0-9]{64}\.png$/,
    );
  });

  it("skips remote-only tracks because they have no local bytes to publish", async () => {
    await seedSet({ remoteOnly: true });

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });

    expect(plan.objects.map((object) => object.kind)).toEqual(["set-index", "manifest"]);
  });
});

async function seedSet(options: { remoteOnly?: boolean } = {}) {
  const session: DjSession = {
    id: "ses_1",
    name: "Night Drive",
    seedPrompt: "city pop at midnight",
    trackIds: ["trk_1"],
    status: "idle",
    config: {
      autoExtend: false,
      refillThreshold: 2,
      batchSize: 1,
      targetDurationSec: 180,
      allowVocals: true,
    },
    displayMode: "video",
    createdAt: 100,
    updatedAt: 200,
  };
  const track: Track = {
    id: "trk_1",
    sessionId: "ses_1",
    title: "Blue Avenue",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 180,
    blobId: options.remoteOnly ? undefined : "blb_media",
    remoteMediaUrl: options.remoteOnly ? "https://other.example.com/blue.mp3" : undefined,
    coverBlobId: options.remoteOnly ? undefined : "blb_cover",
    createdAt: 100,
    playCount: 0,
    liked: false,
    tags: ["city"],
  };
  const memory: Memory = {
    id: "mem_1",
    trackId: "trk_1",
    note: "First listen in Shibuya.",
    photoBlobId: options.remoteOnly ? undefined : "blb_memory",
    createdAt: 150,
  };
  const blobs: MediaBlob[] = options.remoteOnly
    ? []
    : [
        {
          id: "blb_media",
          trackId: "trk_1",
          role: "media",
          mime: "audio/mpeg",
          bytes: 3,
          blob: new Blob(["abc"], { type: "audio/mpeg" }),
        },
        {
          id: "blb_cover",
          trackId: "trk_1",
          role: "cover",
          mime: "image/jpeg",
          bytes: 3,
          blob: new Blob(["def"], { type: "image/jpeg" }),
        },
        {
          id: "blb_memory",
          trackId: "trk_1",
          role: "memory",
          mime: "image/png",
          bytes: 3,
          blob: new Blob(["ghi"], { type: "image/png" }),
        },
      ];

  await db.sessions.put(session);
  await db.tracks.put(track);
  await db.memories.put(memory);
  await db.mediaBlobs.bulkPut(blobs);
}
