import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { MediaBlob, Track } from "@/db/types";
import {
  clearPlaybackCache,
  getCachedRemotePlayback,
  PLAYBACK_CACHE_MAX_BYTES,
  PLAYBACK_CACHE_MIN_BYTES,
  playbackCacheLimitBytes,
  prunePlaybackCache,
  putRemotePlaybackCache,
  summarizePlaybackCache,
} from "./playback-cache";

let db: MuzeroDB;
let restoreStorage: (() => void) | null = null;

beforeEach(async () => {
  restoreStorage?.();
  restoreStorage = null;
  db = new MuzeroDB(`muzero-playback-cache-${crypto.randomUUID()}`);
  await db.open();
});

afterEach(() => {
  db.close();
  restoreStorage?.();
  restoreStorage = null;
});

describe("playback cache LRU", () => {
  it("stores remote playback bytes in OPFS when available", async () => {
    const opfs = installOpfsMock();
    const track = makeTrack("trk_cached", "https://r2.example/audio.mp3");
    await putRemotePlaybackCache(
      track,
      {
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
        mime: "audio/mpeg",
      },
      { maxBytes: 100, now: () => 10 },
      db,
    );

    const row = await db.playbackCache.get("remote:https://r2.example/audio.mp3");
    expect(row).toMatchObject({
      storage: "opfs",
      sourceUrl: "https://r2.example/audio.mp3",
      trackId: "trk_cached",
      mime: "audio/mpeg",
      bytes: 3,
      lastAccessedAt: 10,
    });
    expect(row?.blob).toBeUndefined();
    expect(row?.fileName).toMatch(/\.mp3$/);
    expect(opfs.files.size).toBe(1);

    const hit = await getCachedRemotePlayback(track, db, () => 42);

    expect(hit).toMatchObject({
      sourceUrl: "https://r2.example/audio.mp3",
      trackId: "trk_cached",
      mime: "audio/mpeg",
      lastAccessedAt: 42,
    });
    await expect(summarizePlaybackCache(db)).resolves.toEqual({ count: 1, bytes: 3 });
    await expect(db.playbackCache.get(hit?.id ?? "")).resolves.toMatchObject({
      lastAccessedAt: 42,
    });
  });

  it("falls back to IndexedDB blob storage when OPFS is unavailable", async () => {
    const track = makeTrack("trk_fallback", "https://r2.example/fallback.mp3");
    await putRemotePlaybackCache(
      track,
      {
        blob: { size: 3, type: "audio/mpeg" } as Blob,
        bytes: 3,
        mime: "audio/mpeg",
      },
      { maxBytes: 100, now: () => 10 },
      db,
    );

    const row = await db.playbackCache.get("remote:https://r2.example/fallback.mp3");
    expect(row).toMatchObject({
      storage: "indexeddb",
      blob: { size: 3, type: "audio/mpeg" },
    });

    const hit = await getCachedRemotePlayback(track, db, () => 42);
    expect(hit).toMatchObject({
      sourceUrl: "https://r2.example/fallback.mp3",
      storage: "indexeddb",
      bytes: 3,
      lastAccessedAt: 42,
    });
    expect(hit?.blob).toMatchObject({ size: 3, type: "audio/mpeg" });
  });

  it("removes stale OPFS bytes when a cached row no longer matches the track", async () => {
    const opfs = installOpfsMock();
    const track = makeTrack("trk_cached", "https://r2.example/audio.mp3");
    await putRemotePlaybackCache(
      track,
      {
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
        mime: "audio/mpeg",
      },
      { maxBytes: 100, now: () => 10 },
      db,
    );

    expect(opfs.files.size).toBe(1);

    await expect(
      getCachedRemotePlayback({ ...track, kind: "video" }, db, () => 42),
    ).resolves.toBeNull();

    expect(opfs.files.size).toBe(0);
    await expect(db.playbackCache.count()).resolves.toBe(0);
  });

  it("evicts least-recently-used playback cache entries without touching permanent media blobs", async () => {
    installOpfsMock();
    const permanent: MediaBlob = {
      id: "blb_permanent",
      trackId: "trk_permanent",
      role: "media",
      mime: "audio/mpeg",
      bytes: 10,
      blob: new Blob([new Uint8Array(10)], { type: "audio/mpeg" }),
    };
    await db.mediaBlobs.put(permanent);

    await putRemotePlaybackCache(
      makeTrack("trk_old", "https://r2.example/old.mp3"),
      { blob: new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), mime: "audio/mpeg" },
      { maxBytes: 20, now: () => 1 },
      db,
    );
    await putRemotePlaybackCache(
      makeTrack("trk_new", "https://r2.example/new.mp3"),
      { blob: new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), mime: "audio/mpeg" },
      { maxBytes: 20, now: () => 2 },
      db,
    );

    await prunePlaybackCache(8, db);

    expect(
      await getCachedRemotePlayback(makeTrack("trk_old", "https://r2.example/old.mp3"), db),
    ).toBeNull();
    expect(
      await getCachedRemotePlayback(makeTrack("trk_new", "https://r2.example/new.mp3"), db),
    ).not.toBeNull();
    await expect(db.mediaBlobs.get("blb_permanent")).resolves.toMatchObject({
      id: "blb_permanent",
    });
  });

  it("clears only playback-cache entries", async () => {
    const opfs = installOpfsMock();
    await putRemotePlaybackCache(
      makeTrack("trk_cached", "https://r2.example/audio.mp3"),
      { blob: new Blob([new Uint8Array(3)], { type: "audio/mpeg" }), mime: "audio/mpeg" },
      { maxBytes: 100, now: () => 1 },
      db,
    );
    await db.mediaBlobs.put({
      id: "blb_download",
      trackId: "trk_download",
      role: "media",
      mime: "audio/mpeg",
      bytes: 3,
      blob: new Blob([new Uint8Array(3)], { type: "audio/mpeg" }),
    });

    await clearPlaybackCache(db);

    await expect(summarizePlaybackCache(db)).resolves.toEqual({ count: 0, bytes: 0 });
    expect(opfs.files.size).toBe(0);
    await expect(db.mediaBlobs.get("blb_download")).resolves.toBeTruthy();
  });

  it("clamps the visible cache limit to 1-10 GiB", () => {
    expect(playbackCacheLimitBytes({ id: "app", playbackCacheMaxBytes: 1 })).toBe(
      PLAYBACK_CACHE_MIN_BYTES,
    );
    expect(playbackCacheLimitBytes({ id: "app", playbackCacheMaxBytes: 99 * 1024 ** 3 })).toBe(
      PLAYBACK_CACHE_MAX_BYTES,
    );
  });
});

function makeTrack(id: string, remoteMediaUrl: string): Track {
  return {
    id,
    sessionId: "ses_1",
    title: id,
    kind: "audio",
    origin: "streamed",
    provider: "r2",
    status: "ready",
    durationSec: 30,
    remoteMediaUrl,
    createdAt: 1,
    playCount: 0,
    liked: false,
    tags: [],
  };
}

function installOpfsMock(): { files: Map<string, Blob> } {
  const previous = Object.getOwnPropertyDescriptor(navigator, "storage");
  const files = new Map<string, Blob>();
  const directory = {
    async getFileHandle(fileName: string, options?: { create?: boolean }) {
      if (!files.has(fileName) && !options?.create) throw new Error("missing OPFS file");
      return {
        async createWritable() {
          let pending = new Blob();
          return {
            async write(value: Blob | BlobPart) {
              pending = value instanceof Blob ? value : new Blob([value]);
            },
            async close() {
              files.set(fileName, pending);
            },
          };
        },
        async getFile() {
          const file = files.get(fileName);
          if (!file) throw new Error("missing OPFS file");
          return file;
        },
      };
    },
    async removeEntry(fileName: string) {
      files.delete(fileName);
    },
  };
  const root = {
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      if (name !== "muzero-playback-cache" || options?.create !== true) {
        throw new Error("unexpected OPFS directory request");
      }
      return directory;
    },
  };

  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      async getDirectory() {
        return root;
      },
    },
  });

  restoreStorage = () => {
    if (previous) {
      Object.defineProperty(navigator, "storage", previous);
      return;
    }
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: undefined,
    });
  };
  return { files };
}
