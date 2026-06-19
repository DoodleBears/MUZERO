/**
 * LRCLIB vendor mapping — isolated pure functions, the only place that knows
 * LRCLIB's wire shape (snake_case query params, camelCase JSON response). Mirrors
 * the cloud-provider `mapBrief/parseCreate/parseStatus` discipline so a future
 * source change touches only this file. No IO — exhaustively unit-tested.
 *
 * API: https://lrclib.net/docs
 */

import { type GateLevel, passesGate, scoreCandidate } from "./match-text";
import type { LyricsHit, LyricsMatchInfo, LyricsQuery } from "./provider";

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

/** Relaxations for the search fallback rungs. */
export interface SearchUrlOptions {
  /** Drop `album_name` — album names are the least consistent field across catalogues (L2). */
  dropAlbum?: boolean;
  /** Keep only `track_name` — the widest-recall, artist-free rung (L3). */
  titleOnly?: boolean;
}

/** GET /api/search — fuzzy fallback (no duration; ranked client-side). */
export function buildSearchUrl(q: LyricsQuery, opts: SearchUrlOptions = {}): string {
  const params = new URLSearchParams();
  params.set("track_name", q.trackName);
  if (!opts.titleOnly && q.artistName) params.set("artist_name", q.artistName);
  if (!opts.titleOnly && !opts.dropAlbum && q.albumName) params.set("album_name", q.albumName);
  return `${LRCLIB_BASE_URL}/api/search?${params.toString()}`;
}

/** GET /api/get/{id} — fetch one specific record (manual selection). */
export function buildGetByIdUrl(id: string): string {
  return `${LRCLIB_BASE_URL}/api/get/${encodeURIComponent(id)}`;
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

/**
 * Pick the best candidate by composite confidence (synced tier + duration nearness
 * + title similarity), then enforce the accept/reject gate for the given rung. Unlike
 * the old "closest duration wins", a candidate that clears relative ranking but fails
 * the gate (e.g. only a 30s-off same-name demo exists) is judged a miss — `null` — so
 * a wrong version never gets cached. Defaults to the `noAlbum` rung.
 */
export function pickBestHit(
  hits: LyricsHit[],
  q: LyricsQuery,
  level: GateLevel = "noAlbum",
): LyricsHit | null {
  let best: LyricsHit | null = null;
  let bestConfidence = -1;
  for (const hit of hits) {
    const score = scoreCandidate(hit, q);
    if (!passesGate(score, level)) continue;
    if (score.confidence > bestConfidence) {
      best = hit;
      bestConfidence = score.confidence;
    }
  }
  return best;
}

/** Attach match provenance/confidence to a chosen hit (pure). */
export function attachMatch(
  hit: LyricsHit,
  q: LyricsQuery,
  via: LyricsMatchInfo["via"],
): LyricsHit {
  const score = scoreCandidate(hit, q);
  return {
    ...hit,
    match: {
      confidence: score.confidence,
      durationDelta: score.durationDelta,
      titleSim: score.titleSim,
      via,
    },
  };
}
