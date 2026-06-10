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

/**
 * Filter by a name/seed query (transliteration-aware — pinyin / kana / romaji,
 * via {@link freeTextMatches}) and an optional "liked sets" filter. Track/tag/
 * memory matches inside a set are delegated to `matchesQuery`.
 */
export function filterSets(
  items: SetGalleryItem[],
  query: string,
  filter: SetFilter,
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

/** Sort a copy (never mutates the input) by the chosen mode. */
export function sortSets(items: SetGalleryItem[], sort: SetSort): SetGalleryItem[] {
  const copy = [...items];
  switch (sort) {
    case "name":
      return copy.sort((a, b) => a.session.name.localeCompare(b.session.name));
    case "size":
      return copy.sort((a, b) => b.trackCount - a.trackCount);
    default:
      return copy.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }
}
