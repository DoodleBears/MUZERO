import { setSessionCover, setTrackCover } from "@/db/repositories";
import { log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import type { StreamSearchHit } from "./provider";
import { findStreamedTrack } from "./streamed-track-repo";

export interface CacheStreamPlaylistCoverInput {
  sessionId: string;
  coverUrl?: string;
}

export interface CacheStreamPlaylistCoverDeps {
  fetcher?: typeof globalThis.fetch;
  storeCover?: typeof setSessionCover;
}

export interface CacheStreamTrackCoverInput {
  trackId: string;
  coverUrl?: string;
}

export interface CacheStreamTrackCoverDeps {
  fetcher?: typeof globalThis.fetch;
  storeCover?: typeof setTrackCover;
}

export interface CacheStreamPlaylistTrackCoversInput {
  sessionId: string;
  hits: StreamSearchHit[];
}

export interface CacheStreamPlaylistTrackCoversDeps {
  findTrack?: typeof findStreamedTrack;
  cacheTrackCover?: typeof cacheStreamTrackCover;
}

export async function cacheStreamPlaylistCover(
  input: CacheStreamPlaylistCoverInput,
  deps: CacheStreamPlaylistCoverDeps = {},
): Promise<boolean> {
  const coverUrl = input.coverUrl?.trim();
  if (!coverUrl) return false;

  try {
    const fetcher = deps.fetcher ?? (await getAppFetch());
    const response = await fetcher(coverUrl);
    if (!response.ok) return false;

    const blob = await response.blob();
    const mime = response.headers.get("content-type") ?? blob.type;
    if (!mime.startsWith("image/") || blob.size === 0) return false;

    await (deps.storeCover ?? setSessionCover)({
      sessionId: input.sessionId,
      blob,
      mime,
    });
    return true;
  } catch (error) {
    log.warn("stream", "playlist cover cache failed", { sessionId: input.sessionId, error });
    return false;
  }
}

export async function cacheStreamTrackCover(
  input: CacheStreamTrackCoverInput,
  deps: CacheStreamTrackCoverDeps = {},
): Promise<boolean> {
  const coverUrl = input.coverUrl?.trim();
  if (!coverUrl) return false;

  try {
    const fetcher = deps.fetcher ?? (await getAppFetch());
    const response = await fetcher(coverUrl);
    if (!response.ok) return false;

    const blob = await response.blob();
    const mime = response.headers.get("content-type") ?? blob.type;
    if (!mime.startsWith("image/") || blob.size === 0) return false;

    await (deps.storeCover ?? setTrackCover)({
      trackId: input.trackId,
      blob,
      mime,
    });
    return true;
  } catch (error) {
    log.warn("stream", "track cover cache failed", { trackId: input.trackId, error });
    return false;
  }
}

export async function cacheStreamPlaylistTrackCovers(
  input: CacheStreamPlaylistTrackCoversInput,
  deps: CacheStreamPlaylistTrackCoversDeps = {},
): Promise<{ attempted: number; cached: number; skipped: number }> {
  let attempted = 0;
  let cached = 0;
  let skipped = 0;
  const findTrack = deps.findTrack ?? findStreamedTrack;
  const cacheTrackCover = deps.cacheTrackCover ?? cacheStreamTrackCover;

  for (const hit of input.hits) {
    if (!hit.coverUrl) {
      skipped += 1;
      continue;
    }
    const track = await findTrack(input.sessionId, hit.source, hit.externalId);
    if (!track || track.coverBlobId) {
      skipped += 1;
      continue;
    }
    attempted += 1;
    if (await cacheTrackCover({ trackId: track.id, coverUrl: hit.coverUrl })) cached += 1;
  }

  return { attempted, cached, skipped };
}
