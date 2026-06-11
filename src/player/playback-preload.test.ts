import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { Track } from "@/db/types";
import { coverUrlCache } from "@/lib/object-url-cache";
import { getCachedRemotePlayback } from "@/player/playback-cache";
import { trackCoverCacheKey, warmTrackCover, warmTrackMedia } from "@/player/playback-preload";

let db: MuzeroDB;
let created = 0;

beforeEach(async () => {
  db = new MuzeroDB(`muzero-playback-preload-${crypto.randomUUID()}`);
  await db.open();
  created = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:warm-${++created}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe("playback preload", () => {
  it("warms a local cover into the shared object-url cache", async () => {
    const track = makeTrack("trk_cover", {
      coverBlobId: "blb_cover_warm",
    });
    await db.mediaBlobs.put({
      id: "blb_cover_warm",
      trackId: track.id,
      role: "cover",
      mime: "image/png",
      bytes: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    });

    await warmTrackCover(track, { coverCropped: true, db });

    expect(coverUrlCache.peek(trackCoverCacheKey(track, true)!)).toBe("blob:warm-1");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("downloads a remote R2 media item into the playback LRU cache", async () => {
    const track = makeTrack("trk_remote", {
      remoteMediaUrl: "https://r2.example.com/audio-a.mp3",
    });
    const fetcher = vi.fn(async () => response("audio/mpeg", "audio"));

    await warmTrackMedia(track, { cacheMaxBytes: 1024, db, fetcher });

    expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://r2.example.com/audio-a.mp3", {
      cache: "no-store",
      signal: undefined,
    });
    await expect(getCachedRemotePlayback(track, db)).resolves.toMatchObject({
      sourceUrl: "https://r2.example.com/audio-a.mp3",
      trackId: track.id,
      mime: "audio/mpeg",
      bytes: 5,
    });
  });

  it("skips warming media whose declared size is past the cache cap (PRD F-8)", async () => {
    const track = makeTrack("trk_huge", {
      kind: "video",
      remoteMediaUrl: "https://r2.example.com/movie.mp4",
    });
    const blob = vi.fn(async () => new Blob(["x"], { type: "video/mp4" }));
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          headers: new Headers({
            "content-type": "video/mp4",
            "content-length": String(500 * 1024 * 1024),
          }),
          blob,
          body: null,
        }) as unknown as Response,
    );

    await warmTrackMedia(track, { cacheMaxBytes: 1024, db, fetcher });

    // Neither buffered into memory nor cached — playback streams via loadUrl.
    expect(blob).not.toHaveBeenCalled();
    await expect(getCachedRemotePlayback(track, db)).resolves.toBeFalsy();
  });

  it("does not download remote media again when the playback cache is warm", async () => {
    const track = makeTrack("trk_remote_cached", {
      remoteMediaUrl: "https://r2.example.com/audio-b.mp3",
    });
    const fetcher = vi.fn(async () => response("audio/mpeg", "audio"));

    await warmTrackMedia(track, { cacheMaxBytes: 1024, db, fetcher });
    await warmTrackMedia(track, { cacheMaxBytes: 1024, db, fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function response(mime: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": mime },
  });
}

function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    createdAt: 1,
    durationSec: 30,
    id,
    kind: "audio",
    liked: false,
    origin: "uploaded",
    playCount: 0,
    provider: "upload",
    sessionId: "ses_1",
    status: "ready",
    tags: [],
    title: id,
    ...overrides,
  };
}
