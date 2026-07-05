import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaStorageProvider } from "@/db/media-blob-storage";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession } from "@/db/repositories";
import type { StreamSearchHit } from "./provider";
import {
  addHitsToSet,
  cacheStreamedTrackBlob,
  clearStreamedCache,
  createStreamedTrack,
  findLocalDownloadedVideo,
  findStreamedTrack,
  hitToStreamedInput,
  isStreamedTrackCached,
  materializeHitsToTracks,
  summarizeStreamedCache,
} from "./streamed-track-repo";

let dbName = "";
let db: MuzeroDB;
let counter = 0;

beforeEach(() => {
  dbName = `streamed-repo-test-${counter++}`;
  db = new MuzeroDB(dbName);
});

function createMemoryProvider(id: "opfs" | "electron-file" = "electron-file") {
  const files = new Map<string, Blob>();
  const provider: MediaStorageProvider & { files: Map<string, Blob> } = {
    id,
    userVisible: id === "electron-file",
    files,
    async put(input) {
      const storageKey = `media/${input.id}`;
      files.set(storageKey, input.blob);
      return { storageKey };
    },
    async get(input) {
      return input.storageKey ? (files.get(input.storageKey) ?? null) : null;
    },
    async delete(input) {
      if (input.storageKey) files.delete(input.storageKey);
    },
  };
  return provider;
}

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

describe("findLocalDownloadedVideo", () => {
  const videoHit: StreamSearchHit = {
    ...hit,
    externalId: "BV1xx411c7mD#1001",
    title: "MV",
  };

  it("finds a downloaded streamed video across sessions by source + externalId", async () => {
    const track = await createStreamedTrack(
      { ...hitToStreamedInput("ses_1", videoHit), kind: "video" },
      db,
    );
    await cacheStreamedTrackBlob(
      track.id,
      new Blob(["video"], { type: "video/mp4" }),
      "video/mp4",
      db,
    );

    const found = await findLocalDownloadedVideo("bili", "BV1xx411c7mD#1001", db);

    expect(found?.id).toBe(track.id);
  });

  it("does not treat an online-only streamed video reference as a local download", async () => {
    await createStreamedTrack({ ...hitToStreamedInput("ses_1", videoHit), kind: "video" }, db);

    await expect(
      findLocalDownloadedVideo("bili", "BV1xx411c7mD#1001", db),
    ).resolves.toBeUndefined();
  });

  it("requires video kind and exact part id", async () => {
    const p1 = await createStreamedTrack(
      { ...hitToStreamedInput("ses_1", videoHit), kind: "video" },
      db,
    );
    const p3 = await createStreamedTrack(
      {
        ...hitToStreamedInput("ses_2", { ...videoHit, externalId: "BV1xx411c7mD#3003" }),
        kind: "video",
      },
      db,
    );
    const audio = await createStreamedTrack(
      hitToStreamedInput("ses_3", { ...videoHit, externalId: "BV1xx411c7mD#4004" }),
      db,
    );
    await cacheStreamedTrackBlob(p1.id, new Blob(["p1"], { type: "video/mp4" }), "video/mp4", db);
    await cacheStreamedTrackBlob(p3.id, new Blob(["p3"], { type: "video/mp4" }), "video/mp4", db);
    await cacheStreamedTrackBlob(
      audio.id,
      new Blob(["audio"], { type: "audio/mpeg" }),
      "audio/mpeg",
      db,
    );

    expect((await findLocalDownloadedVideo("bili", "BV1xx411c7mD#1001", db))?.id).toBe(p1.id);
    expect((await findLocalDownloadedVideo("bili", "BV1xx411c7mD#3003", db))?.id).toBe(p3.id);
    await expect(
      findLocalDownloadedVideo("bili", "BV1xx411c7mD#4004", db),
    ).resolves.toBeUndefined();
  });

  it("uses the compound source/external-id index", async () => {
    const whereSpy = vi.spyOn(db.tracks, "where");
    await findLocalDownloadedVideo("bili", "BV1xx411c7mD#1001", db);

    expect(whereSpy).toHaveBeenCalledWith("[streamSourceId+streamExternalId]");
    whereSpy.mockRestore();
  });
});

describe("addHitsToSet", () => {
  const a: StreamSearchHit = { source: "netease", externalId: "1", title: "A" };
  const b: StreamSearchHit = { source: "netease", externalId: "2", title: "B" };
  const c: StreamSearchHit = { source: "netease", externalId: "3", title: "C" };

  it("adds all hits to a fresh set", async () => {
    const set = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const res = await addHitsToSet(set.id, [a, b], db);
    expect(res).toMatchObject({ added: 2, skipped: 0 });
    expect(res.tracks).toHaveLength(2); // resolved rows returned 1:1 in hit order
    expect((await db.sessions.get(set.id))?.trackIds).toHaveLength(2);
  });

  it("dedupes on incremental re-sync: only genuinely new hits count as added", async () => {
    const set = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    await addHitsToSet(set.id, [a, b], db);
    const res = await addHitsToSet(set.id, [b, c], db); // b already present
    expect(res).toMatchObject({ added: 1, skipped: 1 });
    expect((await db.sessions.get(set.id))?.trackIds).toHaveLength(3);
    expect(await db.tracks.where("sessionId").equals(set.id).count()).toBe(3);
  });

  it("reports per-hit progress (done, total) for an import progress bar", async () => {
    const set = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const calls: Array<[number, number]> = [];
    await addHitsToSet(set.id, [a, b, c], db, (done, total) => calls.push([done, total]));
    expect(calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});

// Scale invariant: a 1000+ track playlist import got progressively slower because
// dedup scanned the whole (growing) session per hit — O(n²) — and each track was a
// separate `put`. These assertions are cost-model guards, independent of wall time:
// dedup must use ONE preload scan and new rows must land in ONE bulkPut, no matter
// how many hits. (PRD: 20260702-muzero-playlist-import-async-notify-batch-perf.)
describe("addHitsToSet — batch write is O(n), not O(n²)", () => {
  const manyHits = (n: number): StreamSearchHit[] =>
    Array.from({ length: n }, (_, i) => ({
      source: "netease" as const,
      externalId: String(i),
      title: `T${i}`,
    }));

  it("dedupes with a single per-session scan regardless of hit count", async () => {
    const set = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const whereSpy = vi.spyOn(db.tracks, "where");

    const res = await addHitsToSet(set.id, manyHits(200), db);
    expect(res.added).toBe(200);

    // The per-hit full-set dedup scan (`where("sessionId")…`) must NOT run once per
    // hit. A single preload read of the session's existing tracks is allowed.
    const perSessionScans = whereSpy.mock.calls.filter((c) => String(c[0]) === "sessionId").length;
    expect(perSessionScans).toBeLessThanOrEqual(1);

    whereSpy.mockRestore();
  });

  it("writes new rows with one bulkPut, not one put per track", async () => {
    const set = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const putSpy = vi.spyOn(db.tracks, "put");
    const bulkPutSpy = vi.spyOn(db.tracks, "bulkPut");

    await addHitsToSet(set.id, manyHits(200), db);

    expect(putSpy).not.toHaveBeenCalled();
    expect(bulkPutSpy).toHaveBeenCalledTimes(1);

    putSpy.mockRestore();
    bulkPutSpy.mockRestore();
  });

  it("re-sync into a large existing set also avoids per-hit scans", async () => {
    const set = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    await addHitsToSet(set.id, manyHits(200), db); // seed
    const whereSpy = vi.spyOn(db.tracks, "where");

    // Re-sync the same 200 (all dedupe) + 50 new → still one preload scan, one bulkPut.
    const bulkPutSpy = vi.spyOn(db.tracks, "bulkPut");
    const res = await addHitsToSet(set.id, manyHits(250), db);
    expect(res).toMatchObject({ added: 50, skipped: 200 });

    const perSessionScans = whereSpy.mock.calls.filter((c) => String(c[0]) === "sessionId").length;
    expect(perSessionScans).toBeLessThanOrEqual(1);
    expect(bulkPutSpy).toHaveBeenCalledTimes(1);

    whereSpy.mockRestore();
    bulkPutSpy.mockRestore();
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

  it("stores streamed cache bytes through the selected provider", async () => {
    const track = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    const provider = createMemoryProvider("electron-file");

    const blobId = await cacheStreamedTrackBlob(track.id, audio(1000), "audio/mpeg", db, {
      provider,
    });

    const media = await db.mediaBlobs.get(blobId);
    expect(media).toMatchObject({
      role: "media",
      storageBackend: "electron-file",
      storageKey: `media/${blobId}`,
      blob: undefined,
    });
    expect(provider.files.get(media?.storageKey ?? "")?.size).toBe(1000);
  });

  it("deletes the previous provider-backed streamed cache after replacement", async () => {
    const track = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    const provider = createMemoryProvider("opfs");

    const first = await cacheStreamedTrackBlob(track.id, audio(1000), "audio/mpeg", db, {
      provider,
    });
    const firstKey = (await db.mediaBlobs.get(first))?.storageKey ?? "";
    const second = await cacheStreamedTrackBlob(track.id, audio(2000), "audio/flac", db, {
      provider,
    });

    expect(second).not.toBe(first);
    expect(await db.mediaBlobs.get(first)).toBeUndefined();
    expect(provider.files.has(firstKey)).toBe(false);
    expect(provider.files.get((await db.mediaBlobs.get(second))?.storageKey ?? "")?.size).toBe(
      2000,
    );
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
    expect(await summarizeStreamedCache(db)).toEqual({
      count: 1,
      bytes: 1500,
      sources: [{ sourceId: "bili", count: 1, bytes: 1500 }],
    });
    await cacheStreamedTrackBlob(b.id, audio(500), "audio/mpeg", db);
    expect(await summarizeStreamedCache(db)).toEqual({
      count: 2,
      bytes: 2000,
      sources: [{ sourceId: "bili", count: 2, bytes: 2000 }],
    });
  });

  it("summarizes cached streamed tracks by source", async () => {
    const bili = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    const youtube = await createStreamedTrack(
      hitToStreamedInput("ses_1", {
        ...hit,
        source: "youtube",
        externalId: "yt_1",
        title: "YouTube song",
      }),
      db,
    );

    await cacheStreamedTrackBlob(bili.id, audio(1000), "audio/mpeg", db);
    await cacheStreamedTrackBlob(youtube.id, audio(2500), "audio/mp4", db);

    expect(await summarizeStreamedCache(db)).toEqual({
      count: 2,
      bytes: 3500,
      sources: [
        { sourceId: "youtube", count: 1, bytes: 2500 },
        { sourceId: "bili", count: 1, bytes: 1000 },
      ],
    });
  });

  it("clears the cache, freeing blobs and re-arming re-resolve", async () => {
    const a = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    await cacheStreamedTrackBlob(a.id, audio(1000), "audio/mpeg", db);
    expect(await clearStreamedCache(db)).toBe(1);
    expect((await db.tracks.get(a.id))?.blobId).toBeUndefined();
    expect(await db.mediaBlobs.count()).toBe(0);
    expect(await summarizeStreamedCache(db)).toEqual({ count: 0, bytes: 0, sources: [] });
  });

  it("clears one source without deleting playlist source metadata", async () => {
    const set = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const bili = await createStreamedTrack(hitToStreamedInput(set.id, hit), db);
    const youtube = await createStreamedTrack(
      hitToStreamedInput(set.id, {
        ...hit,
        source: "youtube",
        externalId: "yt_1",
        title: "YouTube song",
      }),
      db,
    );
    await db.sessions.update(set.id, { trackIds: [bili.id, youtube.id] });
    await cacheStreamedTrackBlob(bili.id, audio(1000), "audio/mpeg", db);
    await cacheStreamedTrackBlob(youtube.id, audio(2500), "audio/mp4", db);

    expect(await clearStreamedCache(db, { sourceId: "youtube" })).toBe(1);

    const storedBili = await db.tracks.get(bili.id);
    const storedYoutube = await db.tracks.get(youtube.id);
    expect(storedBili?.blobId).toBeDefined();
    expect(storedYoutube?.blobId).toBeUndefined();
    expect(storedYoutube).toMatchObject({
      streamSourceId: "youtube",
      streamExternalId: "yt_1",
      streamMeta: expect.objectContaining({ artist: "周杰伦" }),
    });
    expect((await db.sessions.get(set.id))?.trackIds).toEqual([bili.id, youtube.id]);
    expect(await summarizeStreamedCache(db)).toEqual({
      count: 1,
      bytes: 1000,
      sources: [{ sourceId: "bili", count: 1, bytes: 1000 }],
    });
  });
});

describe("materializeHitsToTracks", () => {
  const a: StreamSearchHit = { source: "netease", externalId: "1", title: "A" };
  const b: StreamSearchHit = { source: "netease", externalId: "2", title: "B" };

  it("returns rows in hit order without touching set membership", async () => {
    const set = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const tracks = await materializeHitsToTracks(set.id, [b, a], db);
    expect(tracks.map((t) => t.title)).toEqual(["B", "A"]); // hit order, not sorted
    expect(tracks.every((t) => t.origin === "streamed")).toBe(true);
    // Queue items, not collection members: the set's trackIds stays empty.
    expect((await db.sessions.get(set.id))?.trackIds ?? []).toEqual([]);
    expect(await db.tracks.count()).toBe(2);
  });

  it("dedupes on replay: same hits return the same rows (idempotent)", async () => {
    const set = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const first = await materializeHitsToTracks(set.id, [a, b], db);
    const second = await materializeHitsToTracks(set.id, [a, b], db);
    expect(second.map((t) => t.id)).toEqual(first.map((t) => t.id));
    expect(await db.tracks.count()).toBe(2);
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
