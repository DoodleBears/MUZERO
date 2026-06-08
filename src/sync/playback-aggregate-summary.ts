import type { PlaybackAggregate } from "@/db/types";

export interface PlaybackAggregateSummaryFilter {
  scope?: PlaybackAggregate["scope"];
  driveId?: string;
  shareId?: string;
  setId?: string;
  trackId?: string;
  remoteTrackId?: string;
  mediaSha256?: string;
}

export interface PlaybackAggregateSummary {
  deviceCount: number;
  playCount: number;
  listenedSec: number;
  lastPlayedAt?: number;
}

export function summarizePlaybackAggregates(
  rows: PlaybackAggregate[],
  filter: PlaybackAggregateSummaryFilter = {},
): PlaybackAggregateSummary {
  const devices = new Set<string>();
  let playCount = 0;
  let listenedSec = 0;
  let lastPlayedAt: number | undefined;

  for (const row of rows) {
    if (!matchesFilter(row, filter)) continue;
    devices.add(row.devicePublicId);
    playCount += row.playCount;
    listenedSec += row.listenedSec;
    if (row.lastPlayedAt != null) {
      lastPlayedAt = Math.max(lastPlayedAt ?? row.lastPlayedAt, row.lastPlayedAt);
    }
  }

  return {
    deviceCount: devices.size,
    playCount,
    listenedSec,
    lastPlayedAt,
  };
}

function matchesFilter(row: PlaybackAggregate, filter: PlaybackAggregateSummaryFilter): boolean {
  return (
    matchesValue(row.scope, filter.scope) &&
    matchesValue(row.driveId, filter.driveId) &&
    matchesValue(row.shareId, filter.shareId) &&
    matchesValue(row.setId, filter.setId) &&
    matchesValue(row.trackId, filter.trackId) &&
    matchesValue(row.remoteTrackId, filter.remoteTrackId) &&
    matchesValue(row.mediaSha256, filter.mediaSha256)
  );
}

function matchesValue(actual: string | undefined, expected: string | undefined): boolean {
  return expected === undefined || actual === expected;
}
