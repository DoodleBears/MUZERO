/**
 * Pure Last.fm request/response mappings — no IO. Last.fm's `track.getTopTags` returns a
 * folksonomy (genre + mood + style + noise, mixed) with a 0..100 popularity `count` per tag;
 * we keep the meaningful ones (count floor) and let `normalize.ts` canonicalize + drop noise.
 * Best per-track signal for Western catalogues (see the enrichment PRD). Split out (mirrors
 * `musicbrainz-map.ts`) so the shape logic is unit-testable without a fetch shell.
 */

import { normalizeGenres, primaryArtist } from "./normalize";
import type { EnrichmentHit, EnrichmentQuery } from "./provider";

export const LASTFM_BASE_URL = "https://ws.audioscrobbler.com/2.0/";

/** Last.fm tag counts are relative popularity 0..100; below this a tag is long-tail noise. */
export const LASTFM_MIN_TAG_COUNT = 10;

/** Per-track folksonomy match — decent, below an exact recording match, above coarse artist. */
export const LASTFM_MATCH_CONFIDENCE = 0.6;

export function buildTopTagsUrl(q: EnrichmentQuery, apiKey: string): string {
  const params = new URLSearchParams({
    method: "track.gettoptags",
    artist: primaryArtist(q.artistName),
    track: q.trackName,
    api_key: apiKey,
    autocorrect: "1",
    format: "json",
  });
  return `${LASTFM_BASE_URL}?${params.toString()}`;
}

interface RawTag {
  name?: unknown;
  count?: unknown;
}

export interface LastfmTagParse {
  /** Last.fm error code, when the API returned one (6 = track not found). */
  error?: number;
  rawTags: string[];
}

/** `track.getTopTags` → raw tag names above the count floor (or the API error code). */
export function parseTopTags(json: unknown): LastfmTagParse {
  const j = json as { error?: unknown; toptags?: { tag?: unknown } } | null;
  if (j?.error != null) return { error: Number(j.error), rawTags: [] };
  const tag = j?.toptags?.tag;
  const list: RawTag[] = Array.isArray(tag) ? (tag as RawTag[]) : tag ? [tag as RawTag] : [];
  const rawTags = list
    .filter(
      (t) => (typeof t.count === "number" ? t.count : Number(t.count) || 0) >= LASTFM_MIN_TAG_COUNT,
    )
    .map((t) => (typeof t.name === "string" ? t.name : ""))
    .filter(Boolean);
  return { rawTags };
}

/** Build a normalized Last.fm hit from raw tags. Null when nothing survives normalization. */
export function toLastfmHit(rawTags: string[]): EnrichmentHit | null {
  const genres = normalizeGenres(rawTags);
  if (genres.length === 0) return null;
  return {
    source: "lastfm",
    genres,
    rawTags,
    match: { confidence: LASTFM_MATCH_CONFIDENCE, via: "search" },
  };
}
