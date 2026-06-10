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

export type LyricsProviderId = "lrclib";

/** Where a stored lyrics row came from. `manual` = user-supplied, wins on merge. */
export type LyricsSource = "lrclib" | "manual";

/** Persisted lyrics state. `notFound` is a negative-cache marker. */
export type LyricsStatus = "found" | "notFound" | "instrumental";

/** The signature used to look a track up against a provider. */
export interface LyricsQuery {
  trackName: string;
  artistName: string;
  albumName?: string;
  durationSec?: number;
}

/**
 * The lyrics content + provenance that gets persisted (DB `TrackLyrics` extends
 * this in Phase 2) and rendered (`resolveTrackLyrics`).
 */
export interface LyricsRecord {
  source: LyricsSource;
  sourceId?: string;
  /** Raw LRC with `[mm:ss.cs]` timestamps. */
  synced?: string;
  plain?: string;
  instrumental: boolean;
  status: LyricsStatus;
}

/** A provider match result. `null` from `fetch` means "no match found". */
export interface LyricsHit {
  source: LyricsProviderId;
  sourceId?: string;
  synced?: string;
  plain?: string;
  instrumental: boolean;
  /** Which record the provider actually matched (debug / correction). */
  matched: { trackName: string; artistName: string; durationSec: number };
}

export interface LyricsProvider {
  readonly id: LyricsProviderId;
  readonly label: string;
  /** Resolve lyrics for a query. Returns null when nothing matches; throws on network/server errors. */
  fetch(q: LyricsQuery, signal?: AbortSignal): Promise<LyricsHit | null>;
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
