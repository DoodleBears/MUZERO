/**
 * MetadataEnrichmentProvider — the pluggable boundary between MUZERO and whatever
 * supplies genre / style / mood tags for a track that lacks them (uploaded files
 * with no ID3 genre, streamed tracks, older library rows).
 *
 * Mirrors the `LyricsProvider` discipline (pluggable + DI + registry) but is a
 * SEPARATE contract: lyrics *look up words*, enrichment *looks up genre metadata*.
 * The rest of the app only ever talks to this interface — never `if (source === …)`.
 *
 * v1 ships one provider:
 *  - `musicbrainz` — keyless, CORS-friendly, recording→artist genre ladder. E2E-verified
 *    to cover Chinese artists at the artist level (周杰伦→mandopop/中国风). See the PRD
 *    `desktop/20260704-muzero-track-metadata-genre-enrichment-prd`.
 * Later: `lastfm` (BYOK top-tags), `discogs` (style taxonomy), `qq`/`netease` (native
 * detail genre — QQ carries it, NetEase does not), `content` (Essentia audio analysis).
 */

import { z } from "zod";
import type { StreamSourceId } from "@/db/types";

/**
 * Every enrichment provenance value. Single source of truth for the {@link EnrichmentSource}
 * union — never re-declare a narrower literal union (mirrors `LYRICS_SOURCES`).
 */
export const ENRICHMENT_SOURCES = [
  "musicbrainz",
  "lastfm",
  "discogs",
  "qq",
  "netease",
  "content",
  "manual",
] as const;

/** Where an enrichment record came from. `manual` = user-picked, wins on merge. */
export type EnrichmentSource = (typeof ENRICHMENT_SOURCES)[number];

/**
 * How an enrichment row was matched — confidence + which rung produced it. Persisted on
 * {@link EnrichmentRecord} (non-indexed, no DB bump). `via` distinguishes a per-track match
 * (`recording`/`native`/`search`) from a coarse per-artist fallback (`artist`) so the UI /
 * DJ can weight precise genres over artist-level ones. Absent on legacy rows → "unknown".
 */
export interface EnrichmentMatchInfo {
  /** Composite 0..1 confidence. */
  confidence: number;
  /** Which rung produced the match. */
  via: "recording" | "artist" | "native" | "search" | "manual";
}

/** The validated genre payload a provider produces (before persistence provenance is added). */
export const enrichmentResultSchema = z.object({
  /** Canonical genres (normalized). The primary DJ/search signal. */
  genres: z.array(z.string()).max(12).default([]),
  /** Finer-grained styles (e.g. Discogs "Deep House"); optional. */
  styles: z.array(z.string()).max(12).optional(),
  /** Mood/theme-ish tags (Last.fm folksonomy, Essentia); optional. */
  moods: z.array(z.string()).max(12).optional(),
  /** Pre-normalization raw tags — kept for debugging / re-normalization. */
  rawTags: z.array(z.string()).max(50).optional(),
});

export type EnrichmentResult = z.infer<typeof enrichmentResultSchema>;

/** The signature used to look a track up against a provider. */
export interface EnrichmentQuery {
  trackName: string;
  artistName: string;
  albumName?: string;
  /** Source track id (QQ mid / NetEase id) for the native-detail path (Phase 4). */
  externalId?: string;
  /** Which stream source `externalId` belongs to — lets a source-specific provider (e.g. QQ
   *  native genre) self-skip tracks from other sources instead of mis-resolving the id. */
  streamSourceId?: StreamSourceId;
  /** MBID from a file's ID3 (`mediaMetadata.musicBrainzRecordingId`) → exact MB lookup. */
  musicBrainzRecordingId?: string;
}

/** A provider match result. `null` from `fetch` means "no match found" (→ negative cache). */
export interface EnrichmentHit extends EnrichmentResult {
  source: EnrichmentSource;
  sourceId?: string;
  /** How confidently this was matched (per-track vs coarse per-artist). */
  match?: EnrichmentMatchInfo;
}

/**
 * The enrichment content + provenance. Persisted as a row in the `enrichments` table
 * (`TrackEnrichment extends EnrichmentRecord`, adds id/trackId/fetchedAt) — NOT on the Track
 * row (fan-out discipline; see `TrackEnrichment`). Consumed by the DJ (`RecentTrack.genres`),
 * chat `library_search`, and track search. `status:"notFound"` is a negative-cache marker so
 * a miss isn't re-fetched (mirrors `LyricsRecord.status`).
 */
export interface EnrichmentRecord extends EnrichmentResult {
  source: EnrichmentSource;
  sourceId?: string;
  status: "found" | "notFound";
  match?: EnrichmentMatchInfo;
}

export interface MetadataEnrichmentProvider {
  readonly id: EnrichmentSource;
  readonly label: string;
  /** Resolve genre metadata for a query. Returns null when nothing matches; throws on
   *  network/server errors so the caller can distinguish a miss from a failure. */
  fetch(q: EnrichmentQuery, signal?: AbortSignal): Promise<EnrichmentHit | null>;
  /** Manual correction: list candidate matches for a query (annotation editor). */
  search?(q: EnrichmentQuery, signal?: AbortSignal): Promise<EnrichmentHit[]>;
  /** Best-effort reachability check for Settings. */
  health?(): Promise<boolean>;
}

export class EnrichmentError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EnrichmentError";
  }
}
