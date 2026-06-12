import type { PlaybackEvent, RemoteSearchTrack, Track, TrackPlaybackStats } from "@/db/types";

export type SystemPlaylistId = "system:liked" | "system:recent" | "system:most";
export type MostPlayedRange = "all" | "month" | "week" | "day";
export type SystemPlaylistSort = "default" | "play-count" | "last-played";

export interface SystemPlaylistDefinition {
  id: SystemPlaylistId;
  icon: "heart" | "history" | "chart";
  deletable: false;
  editableMetadata: false;
}

export interface SystemPlaylistTrackMetric {
  trackId?: string;
  remoteTrackId?: string;
  playCount: number;
  listenedSec: number;
  lastPlayedAt?: number;
}

export type SystemPlaylistPlayable =
  | {
      kind: "local-track";
      id: string;
      title: string;
      track: Track;
      metric: SystemPlaylistTrackMetric;
    }
  | {
      kind: "remote-track";
      id: string;
      title: string;
      remote: RemoteSearchTrack;
      metric: SystemPlaylistTrackMetric;
    };

const DAY_MS = 24 * 60 * 60 * 1000;

export const SYSTEM_PLAYLISTS: SystemPlaylistDefinition[] = [
  { id: "system:liked", icon: "heart", deletable: false, editableMetadata: false },
  { id: "system:recent", icon: "history", deletable: false, editableMetadata: false },
  { id: "system:most", icon: "chart", deletable: false, editableMetadata: false },
];

export function getSystemPlaylistDefinitions(): SystemPlaylistDefinition[] {
  return SYSTEM_PLAYLISTS;
}

export function deriveHeartedPlaylist(tracks: Track[]): Track[] {
  return [...tracks]
    .filter((track) => isPlayableLocalTrack(track) && track.liked)
    .sort(
      (a, b) =>
        (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) ||
        a.title.localeCompare(b.title) ||
        a.createdAt - b.createdAt,
    );
}

export function deriveHeartedPlaylistRows(
  tracks: Track[],
  input: { stats: TrackPlaybackStats[] },
): SystemPlaylistPlayable[] {
  const metricsByTrackId = foldTrackStats(input.stats);
  return deriveHeartedPlaylist(tracks).map((track) =>
    toLocalPlayable(track, metricsByTrackId.get(track.id) ?? emptyTrackMetric(track.id)),
  );
}

export function deriveRecentlyPlayedPlaylist(
  tracks: Track[],
  input: {
    stats: TrackPlaybackStats[];
    events: PlaybackEvent[];
    remoteTracks?: RemoteSearchTrack[];
  },
): SystemPlaylistPlayable[] {
  const trackById = playableTrackMap(tracks);
  const remoteByKey = remoteTrackMap(input.remoteTracks ?? []);
  const rows = new Map<string, SystemPlaylistPlayable>();

  for (const metric of foldTrackStats(input.stats).values()) {
    if (!metric.trackId || metric.lastPlayedAt == null) continue;
    const track = trackById.get(metric.trackId);
    if (!track) continue;
    rows.set(track.id, toLocalPlayable(track, metric));
  }

  for (const metric of foldRemoteEvents(input.events, remoteByKey).values()) {
    if (!metric.remoteTrackId || metric.lastPlayedAt == null) continue;
    const remote = remoteByKey.get(metric.remoteTrackId);
    if (!remote) continue;
    rows.set(remotePlayableId(remote), toRemotePlayable(remote, metric));
  }

  return [...rows.values()].sort(compareRecentlyPlayed);
}

export function deriveMostPlayedPlaylist(
  tracks: Track[],
  input: {
    range: MostPlayedRange;
    now: number;
    stats: TrackPlaybackStats[];
    events: PlaybackEvent[];
    remoteTracks?: RemoteSearchTrack[];
  },
): SystemPlaylistPlayable[] {
  const trackById = playableTrackMap(tracks);
  const remoteByKey = remoteTrackMap(input.remoteTracks ?? []);
  const rows: SystemPlaylistPlayable[] = [];

  if (input.range === "all") {
    for (const metric of foldTrackStats(input.stats).values()) {
      if (!metric.trackId || metric.playCount <= 0) continue;
      const track = trackById.get(metric.trackId);
      if (track) rows.push(toLocalPlayable(track, metric));
    }
    for (const metric of foldRemoteEvents(input.events, remoteByKey).values()) {
      if (!metric.remoteTrackId || metric.playCount <= 0) continue;
      const remote = remoteByKey.get(metric.remoteTrackId);
      if (remote) rows.push(toRemotePlayable(remote, metric));
    }
    return rows.sort(compareMostPlayed);
  }

  const start = getMostPlayedRangeStart(input.range, input.now);
  const localMetrics = foldWindowEvents(input.events, input.now, start, trackById, remoteByKey);
  for (const metric of localMetrics.local.values()) {
    if (!metric.trackId || metric.playCount <= 0) continue;
    const track = trackById.get(metric.trackId);
    if (track) rows.push(toLocalPlayable(track, metric));
  }
  for (const metric of localMetrics.remote.values()) {
    if (!metric.remoteTrackId || metric.playCount <= 0) continue;
    const remote = remoteByKey.get(metric.remoteTrackId);
    if (remote) rows.push(toRemotePlayable(remote, metric));
  }
  return rows.sort(compareMostPlayed);
}

export function getMostPlayedRangeStart(range: MostPlayedRange, now: number): number | undefined {
  switch (range) {
    case "day":
      return localDayStart(now);
    case "week":
      return now - 7 * DAY_MS;
    case "month":
      return now - 30 * DAY_MS;
    default:
      return undefined;
  }
}

export function sortSystemPlaylistRows(
  rows: SystemPlaylistPlayable[],
  sort: SystemPlaylistSort,
): SystemPlaylistPlayable[] {
  switch (sort) {
    case "play-count":
      return [...rows].sort(compareMostPlayed);
    case "last-played":
      return [...rows].sort(compareLastPlayed);
    default:
      return [...rows];
  }
}

function localDayStart(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function isPlayableLocalTrack(track: Track): boolean {
  return track.status === "ready";
}

function playableTrackMap(tracks: Track[]): Map<string, Track> {
  return new Map(tracks.filter(isPlayableLocalTrack).map((track) => [track.id, track]));
}

function foldTrackStats(stats: TrackPlaybackStats[]): Map<string, SystemPlaylistTrackMetric> {
  const out = new Map<string, SystemPlaylistTrackMetric>();
  for (const row of stats) {
    const current = out.get(row.trackId);
    out.set(row.trackId, {
      trackId: row.trackId,
      playCount: (current?.playCount ?? 0) + row.playCount,
      listenedSec: (current?.listenedSec ?? 0) + row.listenedSec,
      lastPlayedAt: maxDefined(current?.lastPlayedAt, row.lastPlayedAt),
    });
  }
  return out;
}

function foldRemoteEvents(
  events: PlaybackEvent[],
  remoteByKey: Map<string, RemoteSearchTrack>,
): Map<string, SystemPlaylistTrackMetric> {
  const out = new Map<string, SystemPlaylistTrackMetric>();
  for (const event of events) {
    const key = remoteRefKey(event.remoteTrackRef);
    if (!key || !remoteByKey.has(key)) continue;
    mergeEventMetric(out, key, event, { remoteTrackId: key });
  }
  return out;
}

function foldWindowEvents(
  events: PlaybackEvent[],
  now: number,
  start: number | undefined,
  trackById: Map<string, Track>,
  remoteByKey: Map<string, RemoteSearchTrack>,
): {
  local: Map<string, SystemPlaylistTrackMetric>;
  remote: Map<string, SystemPlaylistTrackMetric>;
} {
  const local = new Map<string, SystemPlaylistTrackMetric>();
  const remote = new Map<string, SystemPlaylistTrackMetric>();
  for (const event of events) {
    const at = eventTime(event);
    if (at > now || (start != null && at < start)) continue;

    if (event.trackId && trackById.has(event.trackId)) {
      mergeEventMetric(local, event.trackId, event, { trackId: event.trackId });
      continue;
    }

    const remoteKey = remoteRefKey(event.remoteTrackRef);
    if (remoteKey && remoteByKey.has(remoteKey)) {
      mergeEventMetric(remote, remoteKey, event, { remoteTrackId: remoteKey });
    }
  }
  return { local, remote };
}

function mergeEventMetric(
  map: Map<string, SystemPlaylistTrackMetric>,
  key: string,
  event: PlaybackEvent,
  identity: Pick<SystemPlaylistTrackMetric, "remoteTrackId" | "trackId">,
) {
  const current = map.get(key);
  const at = eventTime(event);
  map.set(key, {
    ...identity,
    playCount: (current?.playCount ?? 0) + (event.countedAsPlay ? 1 : 0),
    listenedSec: (current?.listenedSec ?? 0) + Math.max(0, Math.round(event.listenedSec)),
    lastPlayedAt: event.countedAsPlay
      ? maxDefined(current?.lastPlayedAt, at)
      : current?.lastPlayedAt,
  });
}

function eventTime(event: PlaybackEvent): number {
  return event.endedAt ?? event.startedAt;
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function toLocalPlayable(track: Track, metric: SystemPlaylistTrackMetric): SystemPlaylistPlayable {
  return {
    id: track.id,
    kind: "local-track",
    metric,
    title: track.title,
    track,
  };
}

function emptyTrackMetric(trackId: string): SystemPlaylistTrackMetric {
  return {
    listenedSec: 0,
    playCount: 0,
    trackId,
  };
}

function toRemotePlayable(
  remote: RemoteSearchTrack,
  metric: SystemPlaylistTrackMetric,
): SystemPlaylistPlayable {
  return {
    id: remotePlayableId(remote),
    kind: "remote-track",
    metric,
    remote,
    title: remote.title,
  };
}

function remoteTrackMap(rows: RemoteSearchTrack[]): Map<string, RemoteSearchTrack> {
  const out = new Map<string, RemoteSearchTrack>();
  for (const row of rows) {
    if (!row.mediaAvailable) continue;
    out.set(remoteTrackKey(row.driveId, row.shareId, row.trackId), row);
  }
  return out;
}

function remotePlayableId(row: RemoteSearchTrack): string {
  return remoteTrackKey(row.driveId, row.shareId, row.trackId);
}

function remoteTrackKey(driveId: string, shareId: string | undefined, trackId: string): string {
  return `remote:${driveId}:${shareId ?? "local"}:${trackId}`;
}

function remoteRefKey(ref: PlaybackEvent["remoteTrackRef"] | undefined): string | undefined {
  if (!ref) return undefined;
  return remoteTrackKey(ref.driveId, ref.shareId, ref.trackId);
}

function compareRecentlyPlayed(a: SystemPlaylistPlayable, b: SystemPlaylistPlayable): number {
  return (
    (b.metric.lastPlayedAt ?? 0) - (a.metric.lastPlayedAt ?? 0) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

function compareMostPlayed(a: SystemPlaylistPlayable, b: SystemPlaylistPlayable): number {
  return (
    b.metric.playCount - a.metric.playCount ||
    b.metric.listenedSec - a.metric.listenedSec ||
    (b.metric.lastPlayedAt ?? 0) - (a.metric.lastPlayedAt ?? 0) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

function compareLastPlayed(a: SystemPlaylistPlayable, b: SystemPlaylistPlayable): number {
  return (
    (b.metric.lastPlayedAt ?? 0) - (a.metric.lastPlayedAt ?? 0) ||
    b.metric.playCount - a.metric.playCount ||
    b.metric.listenedSec - a.metric.listenedSec ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}
