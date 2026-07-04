/**
 * Distinct genre→count and tag→count over a set of tracks — the "what's actually IN this
 * library / set" facets. Injected into the DJ system prompt (library-wide, see
 * `buildLibraryFacetsContext`) so the DJ knows the real vocabulary before curating, and
 * returned by `set_get` (per-set) so it can reason about a playlist's makeup.
 *
 * A track's genre is `mediaMetadata.genres ∪ enrichment (genres ∪ styles, status "found")`,
 * normalized case-insensitively and counted ONCE per track — the same union `projectTrack`'s
 * `genre` field exposes. Pure; the caller supplies the enrichment map. Tags come off `track.tags`.
 */

import type { Track } from "@/db/types";

export interface Facet {
  name: string;
  count: number;
}

export interface LibraryFacets {
  /** Genres present, most-common first. */
  genres: Facet[];
  /** Listener tags present, most-common first. */
  tags: Facet[];
}

/** Default cap per dimension — enough to convey the palette without bloating the prompt. */
export const DEFAULT_FACET_LIMIT = 60;

/** Full (uncapped) genre + tag count maps. The mutable aggregate a cache can update in place. */
export interface FacetCounts {
  genreCounts: Map<string, number>;
  tagCounts: Map<string, number>;
}

function normGenre(raw: string): string {
  return raw.trim().toLowerCase();
}

/** counts map → top-N facets, sorted by count desc then name asc. */
export function topFacets(counts: ReadonlyMap<string, number>, limit: number): Facet[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * Full genre + tag counts over the tracks (each counted once per track). The uncapped maps back
 * the DJ-palette cache, which can then update tag counts INCREMENTALLY on a tag edit (delta of
 * the two tags) instead of rescanning the whole library. {@link computeFacets} caps these for
 * a one-shot read (set_get).
 */
export function computeFacetCounts(
  tracks: readonly Track[],
  enrichmentGenreByTrack: ReadonlyMap<string, readonly string[]>,
): FacetCounts {
  const genreCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const t of tracks) {
    // Distinct within the track so file+enrichment overlap (e.g. "Pop" + "pop") counts once.
    const genres = new Set<string>();
    for (const g of t.mediaMetadata?.genres ?? []) {
      const n = normGenre(g);
      if (n) genres.add(n);
    }
    for (const g of enrichmentGenreByTrack.get(t.id) ?? []) {
      const n = normGenre(g);
      if (n) genres.add(n);
    }
    for (const g of genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);

    const tags = new Set<string>();
    for (const tag of t.tags ?? []) {
      const n = tag.trim();
      if (n) tags.add(n);
    }
    for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  return { genreCounts, tagCounts };
}

export function computeFacets(
  tracks: readonly Track[],
  enrichmentGenreByTrack: ReadonlyMap<string, readonly string[]>,
  opts: { limit?: number } = {},
): LibraryFacets {
  const limit = opts.limit ?? DEFAULT_FACET_LIMIT;
  const { genreCounts, tagCounts } = computeFacetCounts(tracks, enrichmentGenreByTrack);
  return { genres: topFacets(genreCounts, limit), tags: topFacets(tagCounts, limit) };
}

/** Apply a single track's tag edit to a live tag-count map, in place — decrement tags removed,
 *  increment tags added (a tag present in both is untouched). O(changed tags), never a rescan. */
export function applyTagEditToCounts(
  tagCounts: Map<string, number>,
  oldTags: readonly string[],
  newTags: readonly string[],
): void {
  const before = new Set(oldTags.map((t) => t.trim()).filter(Boolean));
  const after = new Set(newTags.map((t) => t.trim()).filter(Boolean));
  for (const t of before) {
    if (after.has(t)) continue;
    const next = (tagCounts.get(t) ?? 0) - 1;
    if (next > 0) tagCounts.set(t, next);
    else tagCounts.delete(t);
  }
  for (const t of after) {
    if (before.has(t)) continue;
    tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
}
