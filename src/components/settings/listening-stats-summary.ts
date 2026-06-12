import type { DjSession, PlaybackAggregate, PlaybackEvent, Track } from "@/db/types";

export type ListeningStatsRange = "7d" | "30d" | "all";

export interface ListeningStatsSyncSummary {
  pendingEventCount: number;
  pendingListenedSec: number;
  uploadedSegmentCount: number;
}

export interface ListeningStatsItem {
  id: string;
  label: string;
  playCount: number;
  listenedSec: number;
  lastPlayedAt?: number;
}

export interface ListeningTagItem {
  tag: string;
  playCount: number;
  listenedSec: number;
}

export interface ListeningRecentItem {
  id: string;
  label: string;
  listenedSec: number;
  startedAt: number;
}

export interface ListeningStatsSummary {
  playCount: number;
  listenedSec: number;
  uniqueTrackCount: number;
  activeDayCount: number;
  pendingEventCount: number;
  pendingListenedSec: number;
  uploadedSegmentCount: number;
  topTracksByTime: ListeningStatsItem[];
  topTracksByPlays: ListeningStatsItem[];
  topSets: ListeningStatsItem[];
  topTags: ListeningTagItem[];
  recentlyPlayed: ListeningRecentItem[];
}

export function summarizeListeningStats(input: {
  tracks: Track[];
  sessions: DjSession[];
  aggregates: PlaybackAggregate[];
  events: PlaybackEvent[];
  sync: ListeningStatsSyncSummary;
  range: ListeningStatsRange;
  now: number;
  limit?: number;
}): ListeningStatsSummary {
  const limit = input.limit ?? 5;
  const tracks = new Map(input.tracks.map((track) => [track.id, track]));
  const sessions = new Map(input.sessions.map((session) => [session.id, session]));
  const cutoff = rangeCutoff(input.range, input.now);
  const events = input.events.filter((event) => cutoff == null || event.startedAt >= cutoff);
  const trackStats =
    input.range === "all" && input.aggregates.some((row) => row.scope === "track")
      ? statsFromTrackAggregates(input.aggregates)
      : statsFromEvents(events, (event) => event.trackId);
  const setStats =
    input.range === "all" && input.aggregates.some((row) => row.scope === "set")
      ? statsFromSetAggregates(input.aggregates)
      : statsFromEvents(events, (event) => event.context.setId);

  const playCount = sumStats(trackStats, "playCount");
  const listenedSec = sumStats(trackStats, "listenedSec");
  const uniqueTrackCount = Array.from(trackStats.values()).filter(
    (stat) => stat.listenedSec > 0 || stat.playCount > 0,
  ).length;
  const activeDayCount = new Set(events.map((event) => dayKey(event.startedAt))).size;

  return {
    playCount,
    listenedSec,
    uniqueTrackCount,
    activeDayCount,
    pendingEventCount: input.sync.pendingEventCount,
    pendingListenedSec: input.sync.pendingListenedSec,
    uploadedSegmentCount: input.sync.uploadedSegmentCount,
    topTracksByTime: topItems(
      trackStats,
      limit,
      "listenedSec",
      (id) => tracks.get(id)?.title ?? id,
    ),
    topTracksByPlays: topItems(trackStats, limit, "playCount", (id) => tracks.get(id)?.title ?? id),
    topSets: topItems(setStats, limit, "listenedSec", (id) => sessions.get(id)?.name ?? id),
    topTags: topTags(trackStats, tracks, limit),
    recentlyPlayed: events
      .filter((event) => event.trackId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
      .map((event) => ({
        id: event.id,
        label: tracks.get(event.trackId ?? "")?.title ?? event.trackId ?? event.id,
        listenedSec: event.listenedSec,
        startedAt: event.startedAt,
      })),
  };
}

function rangeCutoff(range: ListeningStatsRange, now: number): number | undefined {
  if (range === "all") return undefined;
  const days = range === "7d" ? 7 : 30;
  return now - days * 24 * 60 * 60 * 1000;
}

interface Stat {
  playCount: number;
  listenedSec: number;
  lastPlayedAt?: number;
}

function statsFromTrackAggregates(rows: PlaybackAggregate[]): Map<string, Stat> {
  const stats = new Map<string, Stat>();
  for (const row of rows) {
    if (row.scope !== "track" || !row.trackId) continue;
    addStat(stats, row.trackId, row);
  }
  return stats;
}

function statsFromSetAggregates(rows: PlaybackAggregate[]): Map<string, Stat> {
  const stats = new Map<string, Stat>();
  for (const row of rows) {
    if (row.scope !== "set" || !row.setId) continue;
    addStat(stats, row.setId, row);
  }
  return stats;
}

function statsFromEvents(
  events: PlaybackEvent[],
  key: (event: PlaybackEvent) => string | undefined,
): Map<string, Stat> {
  const stats = new Map<string, Stat>();
  for (const event of events) {
    const id = key(event);
    if (!id) continue;
    addStat(stats, id, {
      playCount: event.countedAsPlay ? 1 : 0,
      listenedSec: event.listenedSec,
      lastPlayedAt: event.startedAt,
    });
  }
  return stats;
}

function addStat(stats: Map<string, Stat>, id: string, next: Stat): void {
  const current = stats.get(id) ?? { playCount: 0, listenedSec: 0 };
  stats.set(id, {
    playCount: current.playCount + next.playCount,
    listenedSec: current.listenedSec + next.listenedSec,
    lastPlayedAt: Math.max(current.lastPlayedAt ?? 0, next.lastPlayedAt ?? 0) || undefined,
  });
}

function topItems(
  stats: Map<string, Stat>,
  limit: number,
  field: "playCount" | "listenedSec",
  label: (id: string) => string,
): ListeningStatsItem[] {
  return Array.from(stats.entries())
    .filter(([, stat]) => stat[field] > 0)
    .sort((a, b) => b[1][field] - a[1][field] || label(a[0]).localeCompare(label(b[0])))
    .slice(0, limit)
    .map(([id, stat]) => ({ id, label: label(id), ...stat }));
}

function topTags(
  trackStats: Map<string, Stat>,
  tracks: Map<string, Track>,
  limit: number,
): ListeningTagItem[] {
  const stats = new Map<string, ListeningTagItem>();
  for (const [trackId, stat] of trackStats) {
    const track = tracks.get(trackId);
    for (const tag of track?.tags ?? []) {
      const current = stats.get(tag) ?? { tag, playCount: 0, listenedSec: 0 };
      current.playCount += stat.playCount;
      current.listenedSec += stat.listenedSec;
      stats.set(tag, current);
    }
  }
  return Array.from(stats.values())
    .sort((a, b) => b.listenedSec - a.listenedSec || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

function sumStats(stats: Map<string, Stat>, field: "playCount" | "listenedSec"): number {
  return Array.from(stats.values()).reduce((sum, stat) => sum + stat[field], 0);
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
