/**
 * Pure 专辑 / 歌手 (album / artist) sort — no DB/DOM. Mirrors {@link sortSets} /
 * {@link sortTracks}: the gallery page enriches each derived entity with its sort
 * keys (count / total duration / last-played, folded from the track index +
 * playback stats) and this returns a sorted copy. Exhaustively unit-tested
 * (hard rule #7).
 *
 * Derived entities have no creation/edit clock (they aren't stored rows), so the
 * axes are the entity-meaningful ones:
 *   - `name`     → display name (A→Z)
 *   - `count`    → number of member tracks
 *   - `duration` → total length of member tracks, seconds
 *   - `played`   → most-recently-played member track (never-played = 0)
 * Long-tail pseudo-buckets (Unknown / Various / AI Generated) always pin last,
 * mirroring the index's `sortWithBucketsLast` so they never float to the top.
 */

import type { SortDir } from "@/lib/set-gallery";

export type { SortDir } from "@/lib/set-gallery";

export type EntitySort = "name" | "count" | "duration" | "played";

/**
 * The orientation each sort selects when first picked; clicking the active chip
 * again flips it. Name reads best A→Z; the rest default biggest/most-recent first.
 */
export const ENTITY_SORT_DEFAULT_DIR: Record<EntitySort, SortDir> = {
  name: "asc",
  count: "desc",
  duration: "desc",
  played: "desc",
};

/** The keys a derived album/artist sorts on (built from the index + stats). */
export interface SortableEntity {
  /** Display name — the `name` sort key and the stable tiebreak for the rest. */
  name: string;
  /** Number of member tracks. */
  trackCount: number;
  /** Total duration of member tracks, in seconds. */
  durationSec: number;
  /** Last-played epoch ms across member tracks (0 = never played). */
  lastPlayedAt: number;
  /** Long-tail pseudo-bucket (Unknown / Various / AI Generated) — always sorts last. */
  isBucket: boolean;
}

/** Ascending comparison for a sort field; callers apply the direction sign. */
function compareEntitiesAsc(a: SortableEntity, b: SortableEntity, sort: EntitySort): number {
  switch (sort) {
    case "count":
      return a.trackCount - b.trackCount;
    case "duration":
      return a.durationSec - b.durationSec;
    case "played":
      return a.lastPlayedAt - b.lastPlayedAt;
    default:
      return a.name.localeCompare(b.name);
  }
}

/**
 * Sort a copy (never mutates the input). `dir` defaults to the field's natural
 * orientation ({@link ENTITY_SORT_DEFAULT_DIR}); pseudo-buckets stay pinned to the
 * bottom regardless of field/direction, and equal keys break by name.
 */
export function sortEntities<T extends SortableEntity>(
  items: T[],
  sort: EntitySort,
  dir: SortDir = ENTITY_SORT_DEFAULT_DIR[sort],
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (a.isBucket !== b.isBucket) return a.isBucket ? 1 : -1;
    return sign * compareEntitiesAsc(a, b, sort) || a.name.localeCompare(b.name);
  });
}
