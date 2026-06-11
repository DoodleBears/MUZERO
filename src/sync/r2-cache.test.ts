import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaStorageProvider } from "@/db/media-blob-storage";
import { MuzeroDB } from "@/db/muzero-db";
import type { Track } from "@/db/types";
import { cacheRemoteTrackMedia, type SyncCacheFetch } from "./r2-cache";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-remote-cache-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

function createMemoryProvider(id: "opfs" | "electron-file" = "opfs") {
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

function remoteTrack(partial: Partial<Track> = {}): Track {
  return {
    id: "trk_remote",
    sessionId: "ses_remote",
    title: "Remote Song",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 30,
    remoteMediaUrl: "https://music.example.com/muzero/objects/audio.mp3",
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    ...partial,
  };
}

describe("cacheRemoteTrackMedia", () => {
  it("refuses media whose declared size is past the cache cap (PRD F-8)", async () => {
    await db.tracks.put(remoteTrack({ kind: "video", remoteMediaUrl: "https://r2/movie.mp4" }));
    const fetcher: SyncCacheFetch = async () =>
      ({
        ok: true,
        headers: new Headers({
          "content-type": "video/mp4",
          "content-length": String(500 * 1024 * 1024),
        }),
        blob: async () => new Blob(["x"], { type: "video/mp4" }),
        body: null,
      }) as unknown as Response;

    await expect(cacheRemoteTrackMedia("trk_remote", { fetcher }, db)).rejects.toMatchObject({
      name: "RemoteMediaTooLargeError",
    });
    // Nothing stored, track not linked — the set still streams (caller counts a failure).
    expect((await db.tracks.get("trk_remote"))?.blobId).toBeUndefined();
    expect(await db.mediaBlobs.count()).toBe(0);
  });

  it("downloads a remote media URL into mediaBlobs and links the track", async () => {
    await db.tracks.put(remoteTrack());
    const fetcher: SyncCacheFetch = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });

    const result = await cacheRemoteTrackMedia("trk_remote", { fetcher }, db);

    const track = await db.tracks.get("trk_remote");
    expect(track?.blobId).toBe(result.blobId);
    const media = await db.mediaBlobs.get(result.blobId);
    expect(media).toMatchObject({
      trackId: "trk_remote",
      role: "media",
      mime: "audio/mpeg",
      bytes: 3,
    });
  });

  it("stores downloaded remote media through the selected storage provider", async () => {
    await db.tracks.put(remoteTrack());
    const provider = createMemoryProvider("opfs");
    const fetcher: SyncCacheFetch = async () =>
      new Response(new Uint8Array([1, 2, 3, 4, 5]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });

    const result = await cacheRemoteTrackMedia(
      "trk_remote",
      { fetcher, storage: { provider } },
      db,
    );

    const track = await db.tracks.get("trk_remote");
    expect(track?.blobId).toBe(result.blobId);
    const media = await db.mediaBlobs.get(result.blobId);
    expect(media).toMatchObject({
      trackId: "trk_remote",
      role: "media",
      mime: "audio/mpeg",
      bytes: 5,
      storageBackend: "opfs",
      storageKey: `media/${result.blobId}`,
      blob: undefined,
    });
    expect(provider.files.get(media?.storageKey ?? "")?.size).toBe(5);
  });

  it("accepts video MIME when caching a remote video track", async () => {
    await db.tracks.put(
      remoteTrack({
        kind: "video",
        remoteMediaUrl: "https://music.example.com/muzero/objects/video.mp4",
      }),
    );
    const fetcher: SyncCacheFetch = async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      });

    const result = await cacheRemoteTrackMedia("trk_remote", { fetcher }, db);

    expect(await db.mediaBlobs.get(result.blobId)).toMatchObject({
      role: "media",
      mime: "video/mp4",
      bytes: 4,
    });
  });

  it("does not mutate IndexedDB when a remote audio track returns an image object", async () => {
    await db.tracks.put(remoteTrack());
    const fetcher: SyncCacheFetch = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });

    await expect(cacheRemoteTrackMedia("trk_remote", { fetcher }, db)).rejects.toThrow(
      /expected audio/i,
    );

    expect((await db.tracks.get("trk_remote"))?.blobId).toBeUndefined();
    expect(await db.mediaBlobs.count()).toBe(0);
  });

  it("does not mutate IndexedDB when a remote video track returns an audio object", async () => {
    await db.tracks.put(remoteTrack({ kind: "video" }));
    const fetcher: SyncCacheFetch = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });

    await expect(cacheRemoteTrackMedia("trk_remote", { fetcher }, db)).rejects.toThrow(
      /expected video/i,
    );

    expect((await db.tracks.get("trk_remote"))?.blobId).toBeUndefined();
    expect(await db.mediaBlobs.count()).toBe(0);
  });

  it("rejects local-only tracks without a remote media URL", async () => {
    await db.tracks.put(remoteTrack({ remoteMediaUrl: undefined }));

    await expect(cacheRemoteTrackMedia("trk_remote", {}, db)).rejects.toThrow(/remote media/i);
  });

  it("does not mutate IndexedDB when remote media is missing", async () => {
    await db.tracks.put(remoteTrack());
    const fetcher: SyncCacheFetch = async () => new Response("missing", { status: 404 });

    await expect(cacheRemoteTrackMedia("trk_remote", { fetcher }, db)).rejects.toThrow(/404/);

    expect((await db.tracks.get("trk_remote"))?.blobId).toBeUndefined();
    expect(await db.mediaBlobs.count()).toBe(0);
  });
});
