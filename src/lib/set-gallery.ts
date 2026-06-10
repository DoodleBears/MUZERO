/**
 * Pure 歌单 Gallery logic — filter + sort over sets, no DB/DOM. The gallery page
 * builds {@link SetGalleryItem}s from `sessions` + `tracks` (derived counts +
 * first-track cover), then runs these. Exhaustively unit-tested (hard rule #7).
 */

import type { DjSession } from "@/db/types";
import { freeTextMatches } from "@/lib/search-core";

/** A 歌单 augmented with the stats the gallery filters / sorts / renders on. */
export interface SetGalleryItem {
  session: DjSession;
  trackCount: number;
  likedCount: number;
  /** Sort key for "recent" — set updatedAt or a derived last-played time. */
  lastActivityAt: number;
  /** First track of the set → its cover is the album-grid tile. */
  coverTrackId?: string;
  /** Optional domain matcher for tracks/tags/memories inside the set. */
  matchesQuery?: (query: string) => boolean;
}

export type SetSort = "recent" | "name" | "size";
export type SetFilter = "all" | "liked";
/** Sort direction. Ascending = A→Z / oldest→newest / shortest→longest. */
export type SortDir = "asc" | "desc";

/**
 * The orientation each sort selects when first picked; clicking the active chip
 * again flips it (the gallery owns that toggle, the lib just applies `dir`).
 */
export const SET_SORT_DEFAULT_DIR: Record<SetSort, SortDir> = {
  recent: "desc",
  name: "asc",
  size: "desc",
};

/**
 * Filter by a name/seed query (transliteration-aware — pinyin / kana / romaji,
 * via {@link freeTextMatches}) and an optional "liked sets" filter. Track/tag/
 * memory matches inside a set are delegated to `matchesQuery`.
 */
export function filterSets(
  items: SetGalleryItem[],
  query: string,
  filter: SetFilter = "all",
): SetGalleryItem[] {
  const hasQuery = query.trim().length > 0;
  return items.filter((it) => {
    if (filter === "liked" && it.likedCount <= 0) return false;
    if (!hasQuery) return true;
    return (
      freeTextMatches(query, [it.session.name, it.session.seedPrompt]) ||
      Boolean(it.matchesQuery?.(query))
    );
  });
}

/** Ascending comparison for a sort field; callers apply the direction sign. */
function compareSetsAsc(a: SetGalleryItem, b: SetGalleryItem, sort: SetSort): number {
  switch (sort) {
    case "name":
      return a.session.name.localeCompare(b.session.name);
    case "size":
      return a.trackCount - b.trackCount;
    default:
      return a.lastActivityAt - b.lastActivityAt;
  }
}

/**
 * Sort a copy (never mutates the input). `dir` defaults to the field's natural
 * orientation ({@link SET_SORT_DEFAULT_DIR}); equal keys break by name for a
 * stable, deterministic order.
 */
export function sortSets(
  items: SetGalleryItem[],
  sort: SetSort,
  dir: SortDir = SET_SORT_DEFAULT_DIR[sort],
): SetGalleryItem[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...items].sort(
    (a, b) => sign * compareSetsAsc(a, b, sort) || a.session.name.localeCompare(b.session.name),
  );
}
