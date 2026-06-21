/**
 * Create + dedupe `origin: "streamed"` tracks. Kept out of `db/repositories.ts`
 * (which is being concurrently edited) — it only depends on the db handle + id
 * helper, so a separate module is clean.
 *
 * A streamed track stores the source ref (`streamSourceId` + `streamExternalId`)
 * and a display snapshot, NOT audio bytes — those are resolved on demand at play
 * time (and optionally cached to a blob in Phase 5). The cover is a remote URL.
 */

import {
  deleteMediaBlob,
  type MediaBlobStorageOptions,
  putMediaBlob,
} from "@/db/media-blob-storage";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { prependTrackIds } from "@/db/repositories";
import type { StreamSourceId, StreamSourceMeta, Track, TrackKind } from "@/db/types";
import { newId } from "@/lib/id";
import type { StreamSearchHit } from "./provider";

export interface CreateStreamedTrackInput {
  sessionId: string;
  sourceId: StreamSourceId;
  externalId: string;
  title: string;
  kind?: TrackKind;
  /** Remote cover URL (shown via `remoteCoverUrl` until/unless cached). */
  coverUrl?: string;
  meta?: StreamSourceMeta;
}

/** Map a search hit into the input for {@link createStreamedTrack}. */
export function hitToStreamedInput(
  sessionId: string,
  hit: StreamSearchHit,
): CreateStreamedTrackInput {
  return {
    sessionId,
    sourceId: hit.source,
    externalId: hit.externalId,
    title: hit.title,
    kind: "audio",
    coverUrl: hit.coverUrl,
    meta: {
      artist: hit.artist,
      album: hit.album,
      coverUrl: hit.coverUrl,
      durationSec: hit.durationSec,
    },
  };
}

/** Find an existing streamed track for (session, source, externalId). Non-indexed scan. */
export async function findStreamedTrack(
  sessionId: string,
  sourceId: StreamSourceId,
  externalId: string,
  db: MuzeroDB = defaultDb,
): Promise<Track | undefined> {
  return db.tracks
    .where("sessionId")
    .equals(sessionId)
    .filter(
      (t) =>
        t.origin === "streamed" &&
        t.streamSourceId === sourceId &&
        t.streamExternalId === externalId,
    )
    .first();
}

/**
 * Create a streamed track in a session, or return the existing one if the same
 * external track was already added (dedupe by source + externalId within the set).
 */
export async function createStreamedTrack(
  input: CreateStreamedTrackInput,
  db: MuzeroDB = defaultDb,
): Promise<Track> {
  const existing = await findStreamedTrack(input.sessionId, input.sourceId, input.externalId, db);
  if (existing) return existing;

  const track: Track = {
    id: newId("trk"),
    sessionId: input.sessionId,
    title: input.title,
    kind: input.kind ?? "audio",
    origin: "streamed",
    provider: input.sourceId,
    status: "ready",
    durationSec: input.meta?.durationSec ?? 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    playCount: 0,
    liked: false,
    tags: [],
    streamSourceId: input.sourceId,
    streamExternalId: input.externalId,
    streamMeta: input.meta,
    remoteCoverUrl: input.coverUrl,
    // Mirror the source metadata into mediaMetadata so every existing display surface
    // (trackSubtitle / trackArtists / detail panel) shows the artist + album with no
    // streamed-specific branching — exactly how uploaded tracks carry their tags.
    mediaMetadata:
      input.meta?.artist || input.meta?.album
        ? {
            artists: input.meta.artist ? [input.meta.artist] : undefined,
            album: input.meta.album,
            parser: "manual",
            parsedAt: Date.now(),
          }
        : undefined,
  };
  await db.tracks.put(track);
  return track;
}

export interface AddHitsResult {
  /** Tracks newly added to the set this call. */
  added: number;
  /** Hits that were already in the set (deduped by source + externalId). */
  skipped: number;
}

/**
 * Add a batch of hits (a playlist) into an existing set, auto-deduping: a hit whose
 * (source, externalId) is already a member returns the existing track and is counted
 * as skipped. Used by both "new set from playlist" and "incremental re-sync into set".
 */
export async function addHitsToSet(
  sessionId: string,
  hits: StreamSearchHit[],
  db: MuzeroDB = defaultDb,
  /** Fired after each track is written — drives the import progress bar. */
  onProgress?: (done: number, total: number) => void,
): Promise<AddHitsResult> {
  const session = await db.sessions.get(sessionId);
  const before = new Set(session?.trackIds ?? []);
  const ids: string[] = [];
  for (const hit of hits) {
    const track = await createStreamedTrack(hitToStreamedInput(sessionId, hit), db);
    ids.push(track.id);
    onProgress?.(ids.length, hits.length);
  }
  await prependTrackIds(sessionId, ids, db);
  const addedIds = new Set(ids.filter((id) => !before.has(id)));
  return { added: addedIds.size, skipped: hits.length - addedIds.size };
}

/**
 * Materialize a batch of hits into streamed `Track` rows (deduped by source +
 * externalId within `sessionId`) and return them IN HIT ORDER. Unlike
 * {@link addHitsToSet} it does NOT touch the set's membership (`trackIds`): the rows
 * are queue items for an online-playlist play context, with `sessionId` only their
 * provenance / offline-cache home. Stream URLs stay unresolved (resolved per play).
 */
export async function materializeHitsToTracks(
  sessionId: string,
  hits: StreamSearchHit[],
  db: MuzeroDB = defaultDb,
): Promise<Track[]> {
  const tracks: Track[] = [];
  for (const hit of hits) {
    tracks.push(await createStreamedTrack(hitToStreamedInput(sessionId, hit), db));
  }
  return tracks;
}

// ---------------------------------------------------- offline cache (Phase 5) ----
// Streamed tracks resolve a short-lived URL per play. Optionally we download those
// bytes into `mediaBlobs` (role "media") and set `Track.blobId` so the player's
// existing `if (track.blobId)` branch plays them locally — offline, no re-resolve.

/**
 * Store downloaded media bytes for a streamed track and point `blobId` at them,
 * replacing any previously-cached blob (re-download / quality change). Throws if the
 * track isn't streamed (generated/uploaded already own their bytes).
 */
export async function cacheStreamedTrackBlob(
  trackId: string,
  blob: Blob,
  mime: string,
  db: MuzeroDB = defaultDb,
  storage: MediaBlobStorageOptions = {},
): Promise<string> {
  const track = await db.tracks.get(trackId);
  if (track?.origin !== "streamed") {
    throw new Error(`cacheStreamedTrackBlob: ${trackId} is not a streamed track`);
  }
  const media = await putMediaBlob(
    {
      id: newId("blb"),
      trackId,
      role: "media",
      mime,
      bytes: blob.size,
      blob,
    },
    db,
    storage,
  );
  const priorId = track.blobId;
  try {
    const updated = await db.tracks.update(trackId, { blobId: media.id });
    if (updated === 0) throw new Error(`Track not found: ${trackId}`);
  } catch (error) {
    await deleteMediaBlob(media.id, db, storage);
    throw error;
  }
  if (priorId && priorId !== media.id) await deleteMediaBlob(priorId, db, storage);
  return media.id;
}

/** Whether a streamed track already has its media cached locally. */
export function isStreamedTrackCached(track: Pick<Track, "origin" | "blobId">): boolean {
  return track.origin === "streamed" && typeof track.blobId === "string";
}

export interface StreamCacheSummary {
  /** Streamed tracks with locally-cached media. */
  count: number;
  /** Total cached bytes. */
  bytes: number;
  /** Per-source breakdown, useful for Settings storage management. */
  sources: StreamCacheSourceSummary[];
}

export interface StreamCacheSourceSummary {
  sourceId: StreamSourceId;
  count: number;
  bytes: number;
}

/** Tally the on-device offline cache for streamed tracks (Settings usage display). */
export async function summarizeStreamedCache(
  db: MuzeroDB = defaultDb,
): Promise<StreamCacheSummary> {
  const tracks = (await db.tracks.toArray()).filter(isStreamedTrackCached);
  let count = 0;
  let bytes = 0;
  const bySource = new Map<StreamSourceId, StreamCacheSourceSummary>();
  for (const track of tracks) {
    if (!track.blobId) continue;
    const media = await db.mediaBlobs.get(track.blobId);
    if (media?.role === "media") {
      const mediaBytes = media.bytes ?? media.blob?.size ?? 0;
      count += 1;
      bytes += mediaBytes;
      if (track.streamSourceId) {
        const current = bySource.get(track.streamSourceId) ?? {
          sourceId: track.streamSourceId,
          count: 0,
          bytes: 0,
        };
        current.count += 1;
        current.bytes += mediaBytes;
        bySource.set(track.streamSourceId, current);
      }
    }
  }
  return { count, bytes, sources: [...bySource.values()].sort((a, b) => b.bytes - a.bytes) };
}

export interface ClearStreamedCacheOptions {
  /** Limit eviction to one source; omitted means all streamed cache. */
  sourceId?: StreamSourceId;
}

/**
 * Evict cached streamed media; the tracks stay (re-resolve on next play). Returns the count freed.
 */
export async function clearStreamedCache(
  db: MuzeroDB = defaultDb,
  options: ClearStreamedCacheOptions = {},
): Promise<number> {
  const tracks = (await db.tracks.toArray()).filter(
    (track) =>
      isStreamedTrackCached(track) &&
      (!options.sourceId || track.streamSourceId === options.sourceId),
  );
  let cleared = 0;
  await db.transaction("rw", db.tracks, db.mediaBlobs, async () => {
    for (const track of tracks) {
      if (!track.blobId) continue;
      const media = await db.mediaBlobs.get(track.blobId);
      if (media?.role !== "media") continue;
      await db.mediaBlobs.delete(track.blobId);
      await db.tracks.update(track.id, { blobId: undefined });
      cleared += 1;
    }
  });
  return cleared;
}

/** Convenience wrapper for UI callers that use the default app db. */
export async function clearStreamedCacheForSource(sourceId: StreamSourceId): Promise<number> {
  return clearStreamedCache(defaultDb, { sourceId });
}
