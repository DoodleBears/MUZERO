import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { MediaBlob } from "@/db/types";
import { newId } from "@/lib/id";
import { getAppFetch } from "@/lib/platform";

export type SyncCacheFetch = typeof globalThis.fetch;

export interface CacheRemoteTrackMediaOptions {
  fetcher?: SyncCacheFetch;
  /** Abort the in-flight media download (audit F6). */
  signal?: AbortSignal;
}

export interface CacheRemoteTrackMediaResult {
  blobId: string;
  bytes: number;
  mime: string;
}

async function resolveFetcher(fetcher?: SyncCacheFetch): Promise<SyncCacheFetch> {
  return fetcher ?? getAppFetch();
}

export async function cacheRemoteTrackMedia(
  trackId: string,
  options: CacheRemoteTrackMediaOptions = {},
  db: MuzeroDB = defaultDb,
): Promise<CacheRemoteTrackMediaResult> {
  const track = await db.tracks.get(trackId);
  if (!track) throw new Error(`Track not found: ${trackId}`);
  if (!track.remoteMediaUrl) throw new Error("Track does not have a remote media URL to cache");

  const fetcher = await resolveFetcher(options.fetcher);
  const response = await fetcher(track.remoteMediaUrl, { signal: options.signal });
  if (!response.ok) throw new Error(`Failed to fetch remote media: HTTP ${response.status}`);

  const blob = await response.blob();
  const mime = response.headers.get("content-type") ?? blob.type ?? "application/octet-stream";
  assertRemoteMediaMatchesTrackKind(track.kind, mime);
  const media: MediaBlob = {
    id: newId("blb"),
    trackId,
    role: "media",
    mime,
    bytes: blob.size,
    blob,
  };

  await db.transaction("rw", db.tracks, db.mediaBlobs, async () => {
    await db.mediaBlobs.put(media);
    await db.tracks.update(trackId, { blobId: media.id });
  });

  return { blobId: media.id, bytes: media.bytes, mime: media.mime };
}

function assertRemoteMediaMatchesTrackKind(kind: "audio" | "video", mime: string): void {
  const normalized = mime.toLowerCase();
  if (kind === "audio" && !normalized.startsWith("audio/")) {
    throw new Error(`Remote media role mismatch: expected audio/* for audio track, got ${mime}`);
  }
  if (kind === "video" && !normalized.startsWith("video/")) {
    throw new Error(`Remote media role mismatch: expected video/* for video track, got ${mime}`);
  }
}
