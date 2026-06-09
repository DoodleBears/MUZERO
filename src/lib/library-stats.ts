/**
 * Per-artist / per-album listening stats — a *derived* analytics dimension over
 * the per-track playback signal (`trackPlaybackStats`), NOT a stored/synced
 * aggregate scope. Artist/album are mutable metadata, so stats are re-folded from
 * the current entity index every read (current-truth semantics): re-tagging an
 * artist instantly moves its accumulated time. See PRD §3.4.
 *
 * Keys come straight from the entity index ({@link buildArtistIndex} /
 * {@link buildAlbumIndex}), so a stat map lines up 1:1 with the entities the UI
 * renders, and a track shared by N entities credits each (a collaboration counts
 * for every artist).
 */

import type { TrackPlaybackStats } from "@/db/types";

export interface EntityStat {
  listenedSec: number;
  playCount: number;
  lastPlayedAt?: number;
}

const EMPTY_STAT: EntityStat = { listenedSec: 0, playCount: 0 };

/** Aggregate per-track playback rows across devices into a `trackId → stat` map. */
export function buildTrackStatsMap(rows: readonly TrackPlaybackStats[]): Map<string, EntityStat> {
  const map = new Map<string, EntityStat>();
  for (const row of rows) {
    const current = map.get(row.trackId);
    map.set(row.trackId, {
      listenedSec: (current?.listenedSec ?? 0) + row.listenedSec,
      playCount: (current?.playCount ?? 0) + row.playCount,
      lastPlayedAt: Math.max(current?.lastPlayedAt ?? 0, row.lastPlayedAt ?? 0) || undefined,
    });
  }
  return map;
}

/**
 * Fold per-track stats up to derived entities (artist or album), keyed exactly as
 * the entity index keys them. A track in N entities' `trackIds` credits each.
 */
export function deriveEntityStats(
  entries: ReadonlyArray<{ key: string; trackIds: readonly string[] }>,
  statsByTrackId: ReadonlyMap<string, EntityStat>,
): Map<string, EntityStat> {
  const out = new Map<string, EntityStat>();
  for (const entry of entries) {
    let listenedSec = 0;
    let playCount = 0;
    let lastPlayedAt = 0;
    for (const id of entry.trackIds) {
      const stat = statsByTrackId.get(id);
      if (!stat) continue;
      listenedSec += stat.listenedSec;
      playCount += stat.playCount;
      if (stat.lastPlayedAt) lastPlayedAt = Math.max(lastPlayedAt, stat.lastPlayedAt);
    }
    out.set(entry.key, { listenedSec, playCount, lastPlayedAt: lastPlayedAt || undefined });
  }
  return out;
}

/** A stat lookup that never returns undefined (zero for unplayed entities). */
export function statFor(stats: ReadonlyMap<string, EntityStat>, key: string): EntityStat {
  return stats.get(key) ?? EMPTY_STAT;
}
