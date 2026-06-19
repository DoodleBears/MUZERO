/**
 * Auto-fetch orchestration: when a track becomes current, look its lyrics up
 * once and cache the result (incl. a negative "notFound" marker). Decoupled from
 * the player store so it can be unit-tested with an injected provider + db.
 *
 * Failure policy (CLAUDE.md rule 8 + error-ux): a fetch failure is a background
 * non-event — log and move on, never toast / never block playback.
 */

import type { MuzeroDB } from "@/db/muzero-db";
import { getTrackLyrics, setTrackLyrics } from "@/db/repositories";
import type { AppSettings, Track, TrackLyrics } from "@/db/types";
import { log } from "@/lib/logger";
import { buildLyricsQuery } from "./build-query";
import type {
  LyricsHit,
  LyricsProvider,
  LyricsProviderId,
  LyricsRecord,
  LyricsSource,
} from "./provider";

/** Whether we should hit the network for this track right now. Pure. */
export function shouldAutoFetchLyrics(
  track: Track,
  settings: AppSettings,
  existing: TrackLyrics | undefined,
): boolean {
  if (!settings.autoFetchLyrics) return false;
  if (track.origin === "generated") return false; // uses brief.lyrics, never fetches
  if (existing) return false; // already have it — including the negative cache
  return buildLyricsQuery(track) !== null;
}

/**
 * Map a provider hit (or a miss) into a persistable record. Pure. `source`
 * defaults to "lrclib" (auto-fetch); the manual flow passes "manual" so the
 * result wins on merge and is never overwritten by auto-fetch.
 */
export function lyricsRecordFromHit(
  hit: LyricsHit | null,
  source: LyricsSource = "lrclib",
): LyricsRecord {
  if (!hit) return { source, instrumental: false, status: "notFound" };
  return {
    source,
    sourceId: hit.sourceId,
    synced: hit.synced,
    format: hit.format,
    translation: hit.translation,
    romanization: hit.romanization,
    plain: hit.plain,
    instrumental: hit.instrumental,
    status: hit.instrumental ? "instrumental" : "found",
    // Carry the match confidence/provenance so the UI can flag a low-confidence match.
    ...(hit.match ? { match: hit.match } : {}),
  };
}

/**
 * Lifecycle of an auto-fetch attempt, for the optional reporter (the player store
 * drives the match-progress toast off this — kept out of this module so it stays
 * UI-free and unit-testable). Only emitted when a fetch actually runs (bounded by
 * `shouldAutoFetchLyrics` → once per track, so the toast can't spam).
 */
export type LyricsFetchEvent =
  | { phase: "start" }
  | { phase: "found"; source: LyricsSource; confidence?: number; instrumental: boolean }
  | { phase: "notFound" }
  | { phase: "error" };

export function lyricsSourceForProvider(id: LyricsProviderId): LyricsSource {
  return id === "auto" ? "lrclib" : id;
}

export interface RunAutoFetchOpts {
  track: Track;
  settings: AppSettings;
  provider: LyricsProvider;
  signal?: AbortSignal;
  db?: MuzeroDB;
  /** Injected timestamp for tests; defaults to Date.now() in the repository. */
  now?: number;
  /** Optional lifecycle reporter (drives the match-progress toast). No-op by default. */
  report?: (event: LyricsFetchEvent) => void;
}

/** Look up + cache lyrics for a track if eligible. Never throws. */
export async function runAutoFetchLyrics(opts: RunAutoFetchOpts): Promise<void> {
  const { track, settings, provider, signal, db, now, report } = opts;
  const existing = await getTrackLyrics(track.id, db);
  if (!shouldAutoFetchLyrics(track, settings, existing)) return;
  const query = buildLyricsQuery(track);
  if (!query) return;
  report?.({ phase: "start" });
  try {
    const hit = await provider.fetch(query, signal);
    if (signal?.aborted) return;
    await setTrackLyrics(
      {
        trackId: track.id,
        record: lyricsRecordFromHit(hit, hit?.source ?? lyricsSourceForProvider(provider.id)),
        matched: hit?.matched,
        fetchedAt: now,
      },
      db,
    );
    report?.(
      hit
        ? {
            phase: "found",
            source: hit.source,
            confidence: hit.match?.confidence,
            instrumental: hit.instrumental,
          }
        : { phase: "notFound" },
    );
  } catch (err) {
    if (signal?.aborted) return; // track switched away — not a real failure, don't cache
    log.warn("lyrics", "auto-fetch failed", err);
    // Persist a negative cache so a failed fetch (timeout / network / 5xx) isn't
    // retried automatically on every play. Manual search or "re-fetch" clears it.
    await setTrackLyrics(
      {
        trackId: track.id,
        record: lyricsRecordFromHit(null, lyricsSourceForProvider(provider.id)),
        fetchedAt: now,
      },
      db,
    ).catch(() => {});
    report?.({ phase: "error" });
  }
}
