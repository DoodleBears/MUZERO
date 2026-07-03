/**
 * Pure Discogs request/response mappings — no IO. Discogs has a curated genre + style
 * taxonomy (broad `genre` like "Electronic" + finer `style` like "Deep House"), embedded
 * right on search results → one request. BYOK token. Split out (mirrors `lastfm-map.ts`).
 */

import { normalizeGenres, primaryArtist } from "./normalize";
import type { EnrichmentHit, EnrichmentQuery } from "./provider";

export const DISCOGS_BASE_URL = "https://api.discogs.com";

/** Curated per-release taxonomy — above Last.fm folksonomy, below an exact recording match. */
export const DISCOGS_MATCH_CONFIDENCE = 0.7;

export function buildDiscogsSearchUrl(q: EnrichmentQuery, token: string): string {
  const params = new URLSearchParams({
    type: "release",
    artist: primaryArtist(q.artistName),
    track: q.trackName,
    token,
    per_page: "3",
  });
  return `${DISCOGS_BASE_URL}/database/search?${params.toString()}`;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
}

export interface DiscogsParse {
  genres: string[];
  styles: string[];
}

/** `/database/search` → the top release's raw genre + style arrays. */
export function parseDiscogsSearch(json: unknown): DiscogsParse {
  const top = (json as { results?: { genre?: unknown; style?: unknown }[] } | null)?.results?.[0];
  return { genres: strArray(top?.genre), styles: strArray(top?.style) };
}

/** Normalize genre→genres, style→styles. Null when neither survives normalization. */
export function toDiscogsHit(parse: DiscogsParse): EnrichmentHit | null {
  const genres = normalizeGenres(parse.genres);
  const styles = normalizeGenres(parse.styles);
  if (genres.length === 0 && styles.length === 0) return null;
  return {
    source: "discogs",
    genres,
    ...(styles.length > 0 ? { styles } : {}),
    rawTags: [...parse.genres, ...parse.styles],
    match: { confidence: DISCOGS_MATCH_CONFIDENCE, via: "search" },
  };
}
