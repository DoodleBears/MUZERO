import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "./muzero-db";
import { clearEntityCover, getEntityCover, setEntityCover } from "./repositories";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-test-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

describe("setEntityCover / getEntityCover / clearEntityCover", () => {
  it("stores an artist cover keyed by the entity key and reads it back", async () => {
    await setEntityCover(
      { entityKey: "double j 姜峰", kind: "artist", blob: png(), mime: "image/png" },
      db,
    );

    const row = await db.entityCovers.get("double j 姜峰");
    expect(row?.kind).toBe("artist");
    expect(row?.coverBlobId).toBeTruthy();
    expect(row?.updatedAt).toBeGreaterThan(0);

    // The blob is owner-keyed by the entity key (mirrors the set-cover pattern).
    const blobRow = await db.mediaBlobs.get(row?.coverBlobId ?? "");
    expect(blobRow?.role).toBe("cover");
    expect(blobRow?.trackId).toBe("double j 姜峰");
    expect(blobRow?.mime).toBe("image/png");

    expect(await getEntityCover("double j 姜峰", db)).toBeTruthy();
  });

  it("replacing a cover deletes the previous blob", async () => {
    await setEntityCover({ entityKey: "k", kind: "album", blob: png(), mime: "image/png" }, db);
    const first = (await db.entityCovers.get("k"))?.coverBlobId ?? "";
    await setEntityCover({ entityKey: "k", kind: "album", blob: png(), mime: "image/png" }, db);
    const second = (await db.entityCovers.get("k"))?.coverBlobId ?? "";

    expect(second).not.toBe(first);
    expect(await db.mediaBlobs.get(first)).toBeUndefined();
    expect(await db.mediaBlobs.get(second)).toBeDefined();
  });

  it("persists the square crop rect", async () => {
    await setEntityCover(
      {
        entityKey: "k",
        kind: "album",
        blob: png(),
        mime: "image/png",
        crop: { x: 1, y: 2, width: 3, height: 4 },
      },
      db,
    );
    expect((await db.entityCovers.get("k"))?.crop).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("clearing removes the row and its blob", async () => {
    await setEntityCover({ entityKey: "k", kind: "artist", blob: png(), mime: "image/png" }, db);
    const blobId = (await db.entityCovers.get("k"))?.coverBlobId ?? "";

    await clearEntityCover("k", db);

    expect(await db.entityCovers.get("k")).toBeUndefined();
    expect(await db.mediaBlobs.get(blobId)).toBeUndefined();
    expect(await getEntityCover("k", db)).toBeUndefined();
  });
});
