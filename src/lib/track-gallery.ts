/**
 * Pure 全部歌曲 (all-songs) sort + filter — no DB/DOM. Mirrors {@link sortSets}:
 * the gallery page feeds it the already-loaded track list (plus a lastPlayed map
 * derived from `trackPlaybackStats`), and it returns a sorted copy. Exhaustively
 * unit-tested (hard rule #7).
 *
 * Sort fields cover the common library axes the user asked for:
 *   - `name`     → title (A→Z)
 *   - `created`  → when the song entered the library (`createdAt`)
 *   - `updated`  → last user edit (`updatedAt`, falling back to `createdAt`)
 *   - `played`   → last played (from playback stats; never-played = 0)
 *   - `duration` → length in seconds
 * The 红心 "liked-only" filter is orthogonal to the sort (a separate toggle).
 */

import type { Track } from "@/db/types";
import type { SortDir } from "@/lib/set-gallery";

export type { SortDir } from "@/lib/set-gallery";

export type TrackSort = "name" | "created" | "updated" | "played" | "duration";

/**
 * The orientation each sort selects when first picked; clicking the active chip
 * again flips it. Name reads best A→Z; the rest default newest/longest first.
 */
export const TRACK_SORT_DEFAULT_DIR: Record<TrackSort, SortDir> = {
  name: "asc",
  created: "desc",
  updated: "desc",
  played: "desc",
  duration: "desc",
};

/** trackId → last-played epoch ms (folded from per-device playback stats). */
export type LastPlayedMap = ReadonlyMap<string, number>;

/** Ascending comparison for a sort field; callers apply the direction sign. */
function compareTracksAsc(a: Track, b: Track, sort: TrackSort, lastPlayed?: LastPlayedMap): number {
  switch (sort) {
    case "name":
      return a.title.localeCompare(b.title);
    case "updated":
      return (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt);
    case "played":
      return (lastPlayed?.get(a.id) ?? 0) - (lastPlayed?.get(b.id) ?? 0);
    case "duration":
      return a.durationSec - b.durationSec;
    default:
      return a.createdAt - b.createdAt;
  }
}

/**
 * Sort a copy (never mutates the input). `dir` defaults to the field's natural
 * orientation ({@link TRACK_SORT_DEFAULT_DIR}); equal keys break by title then
 * `createdAt` for a stable, deterministic order.
 */
export function sortTracks(
  tracks: Track[],
  sort: TrackSort,
  dir: SortDir = TRACK_SORT_DEFAULT_DIR[sort],
  lastPlayed?: LastPlayedMap,
): Track[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...tracks].sort(
    (a, b) =>
      sign * compareTracksAsc(a, b, sort, lastPlayed) ||
      a.title.localeCompare(b.title) ||
      a.createdAt - b.createdAt,
  );
}

/** Keep only liked tracks when the 红心 filter is on; otherwise pass through. */
export function filterLikedTracks(tracks: Track[], likedOnly: boolean): Track[] {
  return likedOnly ? tracks.filter((track) => track.liked) : tracks;
}
