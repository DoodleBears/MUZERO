/**
 * LRCLIB vendor mapping — isolated pure functions, the only place that knows
 * LRCLIB's wire shape (snake_case query params, camelCase JSON response). Mirrors
 * the cloud-provider `mapBrief/parseCreate/parseStatus` discipline so a future
 * source change touches only this file. No IO — exhaustively unit-tested.
 *
 * API: https://lrclib.net/docs
 */

import type { LyricsHit, LyricsQuery } from "./provider";

export const LRCLIB_BASE_URL = "https://lrclib.net";

/** GET /api/get — exact-signature match (track + artist + album + duration). */
export function buildGetUrl(q: LyricsQuery): string {
  const params = new URLSearchParams();
  params.set("track_name", q.trackName);
  params.set("artist_name", q.artistName);
  if (q.albumName) params.set("album_name", q.albumName);
  if (q.durationSec != null && Number.isFinite(q.durationSec)) {
    params.set("duration", String(Math.round(q.durationSec)));
  }
  return `${LRCLIB_BASE_URL}/api/get?${params.toString()}`;
}

/** GET /api/search — fuzzy fallback (no duration; ranked client-side). */
export function buildSearchUrl(q: LyricsQuery): string {
  const params = new URLSearchParams();
  params.set("track_name", q.trackName);
  if (q.artistName) params.set("artist_name", q.artistName);
  if (q.albumName) params.set("album_name", q.albumName);
  return `${LRCLIB_BASE_URL}/api/search?${params.toString()}`;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Map one LRCLIB record → LyricsHit. null when it carries no usable lyrics. */
export function parseHit(json: unknown): LyricsHit | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const instrumental = o.instrumental === true;
  const synced = str(o.syncedLyrics);
  const plain = str(o.plainLyrics);
  if (!instrumental && !synced && !plain) return null;
  const id = o.id;
  return {
    source: "lrclib",
    sourceId: typeof id === "number" || typeof id === "string" ? String(id) : undefined,
    synced: instrumental ? undefined : synced,
    plain: instrumental ? undefined : plain,
    instrumental,
    matched: {
      trackName: str(o.trackName) ?? "",
      artistName: str(o.artistName) ?? "",
      durationSec: num(o.duration) ?? 0,
    },
  };
}

/** Map a /api/search array → usable hits (drops empties / non-objects). */
export function parseSearchResults(json: unknown): LyricsHit[] {
  if (!Array.isArray(json)) return [];
  const out: LyricsHit[] = [];
  for (const item of json) {
    const hit = parseHit(item);
    if (hit) out.push(hit);
  }
  return out;
}

/** Tier: synced (0) beats plain-only (1) beats instrumental (2). */
function tier(hit: LyricsHit): number {
  if (hit.instrumental) return 2;
  return hit.synced ? 0 : 1;
}

/** Pick the best match: prefer synced, then closest duration to the query. */
export function pickBestHit(hits: LyricsHit[], q: LyricsQuery): LyricsHit | null {
  if (hits.length === 0) return null;
  const delta = (hit: LyricsHit): number => {
    if (q.durationSec == null || !Number.isFinite(q.durationSec)) return 0;
    return Math.abs(hit.matched.durationSec - q.durationSec);
  };
  let best = hits[0];
  for (let i = 1; i < hits.length; i++) {
    const hit = hits[i];
    const tb = tier(best);
    const th = tier(hit);
    if (th < tb || (th === tb && delta(hit) < delta(best))) best = hit;
  }
  return best;
}
