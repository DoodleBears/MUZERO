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
import type { LyricsHit, LyricsProvider, LyricsRecord } from "./provider";

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

/** Map a provider hit (or a miss) into a persistable record. Pure. */
export function lyricsRecordFromHit(hit: LyricsHit | null): LyricsRecord {
  if (!hit) return { source: "lrclib", instrumental: false, status: "notFound" };
  return {
    source: "lrclib",
    sourceId: hit.sourceId,
    synced: hit.synced,
    plain: hit.plain,
    instrumental: hit.instrumental,
    status: hit.instrumental ? "instrumental" : "found",
  };
}

export interface RunAutoFetchOpts {
  track: Track;
  settings: AppSettings;
  provider: LyricsProvider;
  signal?: AbortSignal;
  db?: MuzeroDB;
  /** Injected timestamp for tests; defaults to Date.now() in the repository. */
  now?: number;
}

/** Look up + cache lyrics for a track if eligible. Never throws. */
export async function runAutoFetchLyrics(opts: RunAutoFetchOpts): Promise<void> {
  const { track, settings, provider, signal, db, now } = opts;
  const existing = await getTrackLyrics(track.id, db);
  if (!shouldAutoFetchLyrics(track, settings, existing)) return;
  const query = buildLyricsQuery(track);
  if (!query) return;
  try {
    const hit = await provider.fetch(query, signal);
    if (signal?.aborted) return;
    await setTrackLyrics(
      {
        trackId: track.id,
        record: lyricsRecordFromHit(hit),
        matched: hit?.matched,
        fetchedAt: now,
      },
      db,
    );
  } catch (err) {
    if (signal?.aborted) return;
    log.warn("lyrics", "auto-fetch failed", err);
  }
}
