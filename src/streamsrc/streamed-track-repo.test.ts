import { beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession } from "@/db/repositories";
import type { StreamSearchHit } from "./provider";
import {
  addHitsToSet,
  cacheStreamedTrackBlob,
  clearStreamedCache,
  createStreamedTrack,
  findStreamedTrack,
  hitToStreamedInput,
  isStreamedTrackCached,
  summarizeStreamedCache,
} from "./streamed-track-repo";

let dbName = "";
let db: MuzeroDB;
let counter = 0;

beforeEach(() => {
  dbName = `streamed-repo-test-${counter++}`;
  db = new MuzeroDB(dbName);
});

const hit: StreamSearchHit = {
  source: "bili",
  externalId: "BV1xx411c7mD#998877",
  title: "晴天",
  artist: "周杰伦",
  album: "叶惠美",
  durationSec: 245,
  coverUrl: "https://i0.hdslb.com/cover.jpg",
};

describe("createStreamedTrack", () => {
  it("persists a streamed track with the source ref + cover + meta", async () => {
    const track = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    expect(track).toMatchObject({
      sessionId: "ses_1",
      origin: "streamed",
      provider: "bili",
      kind: "audio",
      status: "ready",
      title: "晴天",
      durationSec: 245,
      streamSourceId: "bili",
      streamExternalId: "BV1xx411c7mD#998877",
      remoteCoverUrl: "https://i0.hdslb.com/cover.jpg",
    });
    expect(track.streamMeta).toMatchObject({ artist: "周杰伦", album: "叶惠美" });
    expect(track.blobId).toBeUndefined(); // no audio bytes stored — resolved on play
    const stored = await db.tracks.get(track.id);
    expect(stored?.streamExternalId).toBe("BV1xx411c7mD#998877");
  });

  it("dedupes within a session: same source+externalId returns the existing track", async () => {
    const a = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    const b = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    expect(b.id).toBe(a.id);
    expect(await db.tracks.count()).toBe(1);
  });

  it("treats the same external id in a different session as a new track", async () => {
    const a = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    const b = await createStreamedTrack(hitToStreamedInput("ses_2", hit), db);
    expect(b.id).not.toBe(a.id);
    expect(await db.tracks.count()).toBe(2);
  });

  it("treats a different external id in the same session as a new track", async () => {
    await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    await createStreamedTrack(
      hitToStreamedInput("ses_1", { ...hit, externalId: "BV9other#1" }),
      db,
    );
    expect(await db.tracks.count()).toBe(2);
  });
});

describe("findStreamedTrack", () => {
  it("finds an existing streamed track by source + externalId within a session", async () => {
    const created = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    const found = await findStreamedTrack("ses_1", "bili", "BV1xx411c7mD#998877", db);
    expect(found?.id).toBe(created.id);
    expect(await findStreamedTrack("ses_1", "bili", "nope", db)).toBeUndefined();
  });
});

describe("addHitsToSet", () => {
  const a: StreamSearchHit = { source: "netease", externalId: "1", title: "A" };
  const b: StreamSearchHit = { source: "netease", externalId: "2", title: "B" };
  const c: StreamSearchHit = { source: "netease", externalId: "3", title: "C" };

  it("adds all hits to a fresh set", async () => {
    const set = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const res = await addHitsToSet(set.id, [a, b], db);
    expect(res).toEqual({ added: 2, skipped: 0 });
    expect((await db.sessions.get(set.id))?.trackIds).toHaveLength(2);
  });

  it("dedupes on incremental re-sync: only genuinely new hits count as added", async () => {
    const set = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    await addHitsToSet(set.id, [a, b], db);
    const res = await addHitsToSet(set.id, [b, c], db); // b already present
    expect(res).toEqual({ added: 1, skipped: 1 });
    expect((await db.sessions.get(set.id))?.trackIds).toHaveLength(3);
    expect(await db.tracks.where("sessionId").equals(set.id).count()).toBe(3);
  });
});

describe("offline cache (Phase 5)", () => {
  const audio = (n: number) => new Blob([new Uint8Array(n)], { type: "audio/mpeg" });

  it("caches media bytes and points blobId at them", async () => {
    const track = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    expect(isStreamedTrackCached(track)).toBe(false);

    const blobId = await cacheStreamedTrackBlob(track.id, audio(1000), "audio/mpeg", db);
    const stored = await db.tracks.get(track.id);
    expect(stored?.blobId).toBe(blobId);
    expect(isStreamedTrackCached(stored as NonNullable<typeof stored>)).toBe(true);
    expect((await db.mediaBlobs.get(blobId))?.role).toBe("media");
  });

  it("replaces a prior cached blob on re-download (no orphan)", async () => {
    const track = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    const first = await cacheStreamedTrackBlob(track.id, audio(1000), "audio/mpeg", db);
    const second = await cacheStreamedTrackBlob(track.id, audio(2000), "audio/flac", db);
    expect(second).not.toBe(first);
    expect(await db.mediaBlobs.get(first)).toBeUndefined(); // old one evicted
    expect(await db.mediaBlobs.count()).toBe(1);
  });

  it("refuses to cache a non-streamed track", async () => {
    await db.tracks.put({
      ...((await createStreamedTrack(hitToStreamedInput("ses_1", hit), db)) as object),
      id: "trk_up",
      origin: "uploaded",
    } as never);
    await expect(cacheStreamedTrackBlob("trk_up", audio(10), "audio/mpeg", db)).rejects.toThrow();
  });

  it("summarizes only cached streamed tracks", async () => {
    const a = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    const b = await createStreamedTrack(
      hitToStreamedInput("ses_1", { ...hit, externalId: "BV2#2" }),
      db,
    );
    await cacheStreamedTrackBlob(a.id, audio(1500), "audio/mpeg", db);
    // b stays uncached; summary counts only a.
    expect(await summarizeStreamedCache(db)).toEqual({ count: 1, bytes: 1500 });
    await cacheStreamedTrackBlob(b.id, audio(500), "audio/mpeg", db);
    expect(await summarizeStreamedCache(db)).toEqual({ count: 2, bytes: 2000 });
  });

  it("clears the cache, freeing blobs and re-arming re-resolve", async () => {
    const a = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    await cacheStreamedTrackBlob(a.id, audio(1000), "audio/mpeg", db);
    expect(await clearStreamedCache(db)).toBe(1);
    expect((await db.tracks.get(a.id))?.blobId).toBeUndefined();
    expect(await db.mediaBlobs.count()).toBe(0);
    expect(await summarizeStreamedCache(db)).toEqual({ count: 0, bytes: 0 });
  });
});

describe("hitToStreamedInput", () => {
  it("maps a search hit into a streamed-track input", () => {
    expect(hitToStreamedInput("ses_9", hit)).toEqual({
      sessionId: "ses_9",
      sourceId: "bili",
      externalId: "BV1xx411c7mD#998877",
      title: "晴天",
      kind: "audio",
      coverUrl: "https://i0.hdslb.com/cover.jpg",
      meta: {
        artist: "周杰伦",
        album: "叶惠美",
        coverUrl: "https://i0.hdslb.com/cover.jpg",
        durationSec: 245,
      },
    });
  });
});
