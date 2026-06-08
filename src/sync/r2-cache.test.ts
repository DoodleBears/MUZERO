import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
