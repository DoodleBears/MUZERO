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

function normGenre(raw: string): string {
  return raw.trim().toLowerCase();
}

/** counts map → top-N facets, sorted by count desc then name asc. */
function topFacets(counts: Map<string, number>, limit: number): Facet[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function computeFacets(
  tracks: readonly Track[],
  enrichmentGenreByTrack: ReadonlyMap<string, readonly string[]>,
  opts: { limit?: number } = {},
): LibraryFacets {
  const limit = opts.limit ?? DEFAULT_FACET_LIMIT;
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

  return { genres: topFacets(genreCounts, limit), tags: topFacets(tagCounts, limit) };
}
