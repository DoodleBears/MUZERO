/**
 * Pure helper for the `trackLikes` side table (no DB / IndexedDB dependency, so it is
 * unit-testable and importable by both the v26 migration (`muzero-db.ts`) and the
 * repository fns without a circular import). See PRD 20260617-scalable-track-list.
 */
import type { TrackLike } from "./types";

/**
 * Map legacy `tracks.liked` rows → `trackLikes` rows for the one-time v26 backfill.
 * Only `liked === true` tracks get a row (presence = liked). `likedAt` is stamped by
 * the caller (the upgrade clock) so the pure mapper stays deterministic.
 */
export function likeRowsFromLegacyTracks(
  tracks: ReadonlyArray<{ id: string; liked?: boolean }>,
  likedAt: number,
): TrackLike[] {
  return tracks.filter((t) => t.liked === true).map((t) => ({ trackId: t.id, likedAt }));
}
