/**
 * Auto-enrich orchestration: when a track becomes current, look its genre up once and
 * cache the result (incl. a negative "notFound" marker). Decoupled from the player store
 * so it can be unit-tested with an injected provider + db (mirrors `lyrics/auto-fetch.ts`).
 *
 * Failure policy (rule 8 + error-ux): a fetch failure is a background non-event — log and
 * move on, never toast / never block playback. The negative cache stops a failed/empty
 * lookup from being retried on every play.
 */

import type { MuzeroDB } from "@/db/muzero-db";
import { getTrackEnrichment, setTrackEnrichment } from "@/db/repositories";
import type { AppSettings, Track, TrackEnrichment } from "@/db/types";
import { log } from "@/lib/logger";
import { buildEnrichmentQuery } from "./build-query";
import type {
  EnrichmentHit,
  EnrichmentRecord,
  EnrichmentSource,
  MetadataEnrichmentProvider,
} from "./provider";

/** Whether we should hit the network for this track right now. Pure. */
export function shouldAutoEnrich(
  track: Track,
  settings: AppSettings,
  existing: TrackEnrichment | undefined,
): boolean {
  if (settings.autoEnrich === false) return false; // visible Settings toggle, default on
  if (track.origin === "generated") return false; // generated tracks carry brief genre
  if (existing) return false; // already have it — including the negative cache
  return buildEnrichmentQuery(track) !== null;
}

/**
 * Map a provider hit (or a miss) into a persistable record. Pure. A miss writes a
 * `notFound` negative cache so it isn't re-fetched on every play.
 */
export function enrichmentRecordFromHit(
  hit: EnrichmentHit | null,
  fallbackSource: EnrichmentSource = "musicbrainz",
): EnrichmentRecord {
  if (!hit) return { source: fallbackSource, genres: [], status: "notFound" };
  return {
    source: hit.source,
    sourceId: hit.sourceId,
    genres: hit.genres,
    styles: hit.styles,
    moods: hit.moods,
    rawTags: hit.rawTags,
    status: "found",
    ...(hit.match ? { match: hit.match } : {}),
  };
}

export interface RunAutoEnrichOpts {
  track: Track;
  settings: AppSettings;
  provider: MetadataEnrichmentProvider;
  signal?: AbortSignal;
  db?: MuzeroDB;
  /** Injected timestamp for tests; defaults to Date.now() in the repository. */
  now?: number;
}

/**
 * Track ids with a fetch in flight — the now-playing trigger and the library sweep can both
 * reach the same track; this de-dupes so it isn't looked up (or written) twice concurrently.
 */
const inflight = new Set<string>();

/** Look up + cache genre for a track if eligible. Never throws. */
export async function runAutoEnrich(opts: RunAutoEnrichOpts): Promise<void> {
  const { track, settings, provider, signal, db, now } = opts;
  if (inflight.has(track.id)) return; // another driver is already enriching this track
  inflight.add(track.id);
  try {
    const existing = await getTrackEnrichment(track.id, db);
    if (!shouldAutoEnrich(track, settings, existing)) return;
    const query = buildEnrichmentQuery(track);
    if (!query) return;
    try {
      const hit = await provider.fetch(query, signal);
      if (signal?.aborted) return; // track switched away — don't cache a stale result
      await setTrackEnrichment(
        { trackId: track.id, record: enrichmentRecordFromHit(hit, provider.id), fetchedAt: now },
        db,
      );
    } catch (err) {
      if (signal?.aborted) return;
      log.warn("enrich", "auto-enrich failed", err);
      // Negative cache so a failed fetch (timeout / network / 5xx) isn't retried every play.
      // Manual "re-enrich" clears it.
      await setTrackEnrichment(
        { trackId: track.id, record: enrichmentRecordFromHit(null, provider.id), fetchedAt: now },
        db,
      ).catch(() => {});
    }
  } finally {
    inflight.delete(track.id);
  }
}
