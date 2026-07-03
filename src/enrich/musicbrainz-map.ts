/**
 * Pure MusicBrainz request/response mappings — URL builders + tolerant JSON parsers,
 * no IO. The provider (`musicbrainz-provider.ts`) walks these as a recording→artist
 * ladder. Split out (mirrors `lrclib-map.ts`) so the shape logic is unit-testable
 * without a fetch shell.
 *
 * Genre coverage (E2E-verified, see the enrichment PRD): recording-level genre is sparse
 * (Chinese recordings almost always empty), but ARTIST-level genre is dense and covers
 * Chinese/CJK well — so the ladder falls back to the artist when the recording is bare.
 */

import { normalizeGenres, primaryArtist } from "./normalize";
import type { EnrichmentHit, EnrichmentMatchInfo } from "./provider";

export const MUSICBRAINZ_BASE_URL = "https://musicbrainz.org/ws/2";

/** Recording search below this Lucene score is treated as no-match (avoid wild hits). */
export const MIN_RECORDING_SCORE = 80;

/** Escape Lucene query-string specials so a title with quotes/backslashes can't break the query. */
function escapeLucene(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

export function buildRecordingSearchUrl(artist: string, track: string): string {
  const lucene = `artist:"${escapeLucene(primaryArtist(artist))}" AND recording:"${escapeLucene(track)}"`;
  return `${MUSICBRAINZ_BASE_URL}/recording?query=${encodeURIComponent(lucene)}&fmt=json&limit=3`;
}

export function buildRecordingLookupUrl(mbid: string): string {
  return `${MUSICBRAINZ_BASE_URL}/recording/${encodeURIComponent(mbid)}?inc=genres+tags+artist-credits&fmt=json`;
}

export function buildArtistSearchUrl(artist: string): string {
  return `${MUSICBRAINZ_BASE_URL}/artist?query=${encodeURIComponent(primaryArtist(artist))}&fmt=json&limit=1`;
}

export function buildArtistLookupUrl(mbid: string): string {
  return `${MUSICBRAINZ_BASE_URL}/artist/${encodeURIComponent(mbid)}?inc=genres+tags&fmt=json`;
}

interface RawGenreTag {
  name?: unknown;
  count?: unknown;
}
interface RawArtistCredit {
  artist?: { id?: unknown };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** genres[] + tags[], sorted by vote count desc (strongest first), as raw name strings. */
function rawGenreTags(node: { genres?: unknown; tags?: unknown } | null | undefined): string[] {
  const pick = (arr: unknown): RawGenreTag[] => (Array.isArray(arr) ? (arr as RawGenreTag[]) : []);
  const byCount = (a: RawGenreTag, b: RawGenreTag) =>
    (typeof b.count === "number" ? b.count : 0) - (typeof a.count === "number" ? a.count : 0);
  const genres = pick(node?.genres).slice().sort(byCount);
  const tags = pick(node?.tags).slice().sort(byCount);
  return [...genres, ...tags].map((g) => str(g.name)).filter((n): n is string => Boolean(n));
}

export interface RecordingSearchMatch {
  mbid: string;
  score: number;
  /** First-billed artist's MBID, when the search embedded artist-credits (saves a lookup). */
  artistMbid?: string;
}

/** `/recording?query=…` → the top hit above the score gate, or null. */
export function parseRecordingSearch(json: unknown): RecordingSearchMatch | null {
  const rec = (json as { recordings?: unknown[] } | null)?.recordings?.[0] as
    | { id?: unknown; score?: unknown; "artist-credit"?: RawArtistCredit[] }
    | undefined;
  const mbid = str(rec?.id);
  if (!mbid) return null;
  const score = typeof rec?.score === "number" ? rec.score : Number(rec?.score) || 0;
  if (score < MIN_RECORDING_SCORE) return null;
  return { mbid, score, artistMbid: str(rec?.["artist-credit"]?.[0]?.artist?.id) };
}

export interface RecordingLookupResult {
  rawTags: string[];
  artistMbid?: string;
}

/** `/recording/{mbid}?inc=genres+tags+artist-credits` → raw genre/tag names + the artist MBID. */
export function parseRecordingLookup(json: unknown): RecordingLookupResult {
  const node = json as { "artist-credit"?: RawArtistCredit[] } | null;
  return {
    rawTags: rawGenreTags(json as { genres?: unknown; tags?: unknown }),
    artistMbid: str(node?.["artist-credit"]?.[0]?.artist?.id),
  };
}

/** `/artist?query=…` → the top artist's MBID, or undefined. */
export function parseArtistSearch(json: unknown): string | undefined {
  const a = (json as { artists?: { id?: unknown }[] } | null)?.artists?.[0];
  return str(a?.id);
}

/** `/artist/{mbid}?inc=genres+tags` → raw genre/tag names (count-sorted). */
export function parseArtistLookup(json: unknown): string[] {
  return rawGenreTags(json as { genres?: unknown; tags?: unknown });
}

/** Lucene score (0–100) → 0..1 confidence. */
export function scoreToConfidence(score: number): number {
  return Math.max(0, Math.min(1, score / 100));
}

/** Coarse per-artist matches sit below any per-track (recording) match. */
export const ARTIST_MATCH_CONFIDENCE = 0.45;

/** Build a normalized EnrichmentHit from raw MusicBrainz genre/tag names. Null when nothing
 *  survives normalization (all noise) → the caller keeps walking the ladder. */
export function toMusicbrainzHit(
  rawTags: string[],
  via: EnrichmentMatchInfo["via"],
  confidence: number,
  sourceId?: string,
): EnrichmentHit | null {
  const genres = normalizeGenres(rawTags);
  if (genres.length === 0) return null;
  return {
    source: "musicbrainz",
    sourceId,
    genres,
    rawTags,
    match: { confidence, via },
  };
}
