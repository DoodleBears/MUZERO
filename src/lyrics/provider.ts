/**
 * LyricsProvider — the pluggable boundary between MUZERO and whatever supplies
 * lyrics for a track. v1 ships a single source:
 *  - `lrclib` — LRCLIB (lrclib.net): free, keyless, no rate limit; returns both
 *               synced (LRC) and plain lyrics. See `lrclib-provider.ts`.
 *
 * The interface mirrors the `MusicGenProvider` discipline (pluggable + DI +
 * registry) but is a SEPARATE contract: musicgen *generates* audio, lyrics
 * *look up* existing words. The rest of the app only ever talks to this
 * interface — never `if (source === …)`.
 */

import type { LyricFormat } from "./model";

export type LyricsProviderId = "auto" | "lrclib" | "netease" | "amll";

/**
 * Every lyrics provenance value. Single source of truth for both the `LyricsSource`
 * union and the R2 manifest's lyrics `source` enum (`r2-manifest-schema.ts`) — keep
 * them aligned by reusing this array, never re-declaring a narrower literal union.
 */
export const LYRICS_SOURCES = ["lrclib", "netease", "amll", "manual"] as const;

/** Where a stored lyrics row came from. `manual` = user-supplied, wins on merge. */
export type LyricsSource = (typeof LYRICS_SOURCES)[number];

/** Persisted lyrics state. `notFound` is a negative-cache marker. */
export type LyricsStatus = "found" | "notFound" | "instrumental";

/** The signature used to look a track up against a provider. */
export interface LyricsQuery {
  trackName: string;
  artistName: string;
  albumName?: string;
  durationSec?: number;
  /**
   * NetEase songId, when the track streams from NetEase (`streamExternalId`). Lets
   * the NetEase provider fetch the exact official lyrics with no fuzzy search;
   * ignored by other providers.
   */
  neteaseSongId?: string;
}

/**
 * The lyrics content + provenance that gets persisted (DB `TrackLyrics` extends
 * this in Phase 2) and rendered (`resolveTrackLyrics`).
 */
export interface LyricsRecord {
  source: LyricsSource;
  sourceId?: string;
  /** Raw timed lyric text (LRC / Enhanced-LRC / yrc / qrc / TTML). */
  synced?: string;
  /** Which parser to run over `synced`. Defaults to auto-detection when absent. */
  format?: LyricFormat;
  /** Raw translation track (line-level LRC), aligned to `synced` by timestamp. */
  translation?: string;
  /** Raw romanization track (line-level LRC), aligned to `synced` by timestamp. */
  romanization?: string;
  plain?: string;
  instrumental: boolean;
  status: LyricsStatus;
  /** Match provenance/confidence (auto-fetch only); absent for manual / legacy rows. */
  match?: LyricsMatchInfo;
}

/**
 * How a lyrics row was matched — confidence + the signals behind it. Persisted on
 * `LyricsRecord`/`TrackLyrics` (non-indexed, no DB version bump) and used to (a)
 * decide whether a low-confidence result should still write a negative cache and
 * (b) annotate the UI. Absent on rows written before this existed → "unknown".
 */
export interface LyricsMatchInfo {
  /** Composite 0..1 confidence from `scoreCandidate`. */
  confidence: number;
  /** |hit − query| seconds; absent when the query had no duration. */
  durationDelta?: number;
  /** Normalized-title similarity 0..1; absent for exact-signature hits. */
  titleSim?: number;
  /** Which ladder rung produced the match. */
  via: "exact" | "norm" | "primaryArtist" | "noAlbum" | "titleOnly";
}

/** A provider match result. `null` from `fetch` means "no match found". */
export interface LyricsHit {
  source: LyricsSource;
  sourceId?: string;
  synced?: string;
  /** Format of `synced` (e.g. `"yrc"` for NetEase word-level); defaults to auto-detect. */
  format?: LyricFormat;
  /** Raw translation track (line-level LRC), aligned to `synced` by timestamp. */
  translation?: string;
  /** Raw romanization track (line-level LRC), aligned to `synced` by timestamp. */
  romanization?: string;
  plain?: string;
  instrumental: boolean;
  /** Which record the provider actually matched (debug / correction). */
  matched: { trackName: string; artistName: string; durationSec: number };
  /** How confidently this was matched; attached by the ladder/auto pick. */
  match?: LyricsMatchInfo;
}

export interface LyricsProvider {
  readonly id: LyricsProviderId;
  readonly label: string;
  /** Resolve lyrics for a query. Returns null when nothing matches; throws on network/server errors. */
  fetch(q: LyricsQuery, signal?: AbortSignal): Promise<LyricsHit | null>;
  /** Manual correction: list candidate matches for a query (full lyrics included). */
  search?(q: LyricsQuery, signal?: AbortSignal): Promise<LyricsHit[]>;
  /** Manual correction: fetch one specific record by its source id. */
  getById?(id: string, signal?: AbortSignal): Promise<LyricsHit | null>;
  /** Best-effort reachability check for Settings. */
  health?(): Promise<boolean>;
}

export class LyricsError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LyricsError";
  }
}
