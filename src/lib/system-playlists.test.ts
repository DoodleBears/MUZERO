import { describe, expect, it } from "vitest";
import type { PlaybackEvent, RemoteSearchTrack, Track, TrackPlaybackStats } from "@/db/types";
import {
  deriveHeartedPlaylist,
  deriveMostPlayedPlaylist,
  deriveRecentlyPlayedPlaylist,
  getMostPlayedRangeStart,
} from "./system-playlists";

const NOW = new Date(2026, 0, 15, 15, 30, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

describe("system playlist selectors", () => {
  it("derives hearted tracks from ready liked local tracks, newest heart edit first", () => {
    const tracks = [
      track({ id: "trk_old", title: "Old heart", liked: true, updatedAt: NOW - 10_000 }),
      track({ id: "trk_new", title: "New heart", liked: true, updatedAt: NOW - 1_000 }),
      track({ id: "trk_plain", title: "Plain", liked: false, updatedAt: NOW }),
      track({ id: "trk_pending", title: "Pending", liked: true, status: "pending" }),
    ];

    expect(deriveHeartedPlaylist(tracks).map((item) => item.id)).toEqual(["trk_new", "trk_old"]);
  });

  it("derives recently played as unique local tracks folded across devices", () => {
    const tracks = [
      track({ id: "trk_a", title: "A" }),
      track({ id: "trk_b", title: "B" }),
      track({ id: "trk_c", title: "C" }),
    ];
    const stats = [
      stat({ trackId: "trk_a", devicePublicId: "dvc_1", lastPlayedAt: NOW - 5_000 }),
      stat({ trackId: "trk_a", devicePublicId: "dvc_2", lastPlayedAt: NOW - 1_000 }),
      stat({ trackId: "trk_b", devicePublicId: "dvc_1", lastPlayedAt: NOW - 2_000 }),
      stat({ trackId: "missing", devicePublicId: "dvc_1", lastPlayedAt: NOW }),
    ];

    const rows = deriveRecentlyPlayedPlaylist(tracks, { events: [], stats });

    expect(rows.map((row) => row.id)).toEqual(["trk_a", "trk_b"]);
    expect(rows[0].metric).toMatchObject({ lastPlayedAt: NOW - 1_000 });
  });

  it("includes resolvable remote-only playback in recently played", () => {
    const remoteTracks = [
      remote({ id: "rmt_known", driveId: "drv_1", shareId: "shr_1", trackId: "remote_1" }),
    ];
    const events = [
      event({
        id: "ple_remote",
        remoteTrackRef: { driveId: "drv_1", shareId: "shr_1", trackId: "remote_1" },
        startedAt: NOW - 500,
      }),
      event({
        id: "ple_missing",
        remoteTrackRef: { driveId: "drv_1", shareId: "shr_1", trackId: "unknown" },
        startedAt: NOW,
      }),
    ];

    expect(deriveRecentlyPlayedPlaylist([], { events, remoteTracks, stats: [] })).toEqual([
      expect.objectContaining({ id: "remote:drv_1:shr_1:remote_1", kind: "remote-track" }),
    ]);
  });

  it("uses folded playback stats as all-time most-played source of truth", () => {
    const tracks = [track({ id: "trk_a", title: "A" }), track({ id: "trk_b", title: "B" })];
    const stats = [
      stat({ trackId: "trk_a", devicePublicId: "dvc_1", playCount: 1, listenedSec: 20 }),
      stat({ trackId: "trk_a", devicePublicId: "dvc_2", playCount: 2, listenedSec: 40 }),
      stat({ trackId: "trk_b", devicePublicId: "dvc_1", playCount: 2, listenedSec: 120 }),
    ];

    const rows = deriveMostPlayedPlaylist(tracks, { events: [], now: NOW, range: "all", stats });

    expect(rows.map((row) => [row.id, row.metric.playCount, row.metric.listenedSec])).toEqual([
      ["trk_a", 3, 60],
      ["trk_b", 2, 120],
    ]);
  });

  it("aggregates most-played windows from playback events", () => {
    const tracks = [track({ id: "trk_a", title: "A" }), track({ id: "trk_b", title: "B" })];
    const events = [
      event({ id: "ple_a_1", trackId: "trk_a", startedAt: NOW - DAY, listenedSec: 30 }),
      event({ id: "ple_a_2", trackId: "trk_a", startedAt: NOW - 3 * DAY, listenedSec: 15 }),
      event({ id: "ple_b_1", trackId: "trk_b", startedAt: NOW - 2 * DAY, listenedSec: 80 }),
      event({ id: "ple_old", trackId: "trk_b", startedAt: NOW - 8 * DAY, listenedSec: 90 }),
      event({
        id: "ple_sub_threshold",
        trackId: "trk_a",
        startedAt: NOW - 2_000,
        listenedSec: 5,
        countedAsPlay: false,
      }),
    ];

    const rows = deriveMostPlayedPlaylist(tracks, { events, now: NOW, range: "week", stats: [] });

    expect(rows.map((row) => [row.id, row.metric.playCount, row.metric.listenedSec])).toEqual([
      ["trk_a", 2, 50],
      ["trk_b", 1, 80],
    ]);
  });

  it("computes month/week/day boundaries from injected now", () => {
    expect(getMostPlayedRangeStart("all", NOW)).toBeUndefined();
    expect(getMostPlayedRangeStart("month", NOW)).toBe(NOW - 30 * DAY);
    expect(getMostPlayedRangeStart("week", NOW)).toBe(NOW - 7 * DAY);
    expect(getMostPlayedRangeStart("day", NOW)).toBe(new Date(2026, 0, 15).getTime());
  });

  it("includes resolvable remote-only playback in most played ranges", () => {
    const remoteTracks = [
      remote({ id: "rmt_known", driveId: "drv_1", shareId: "shr_1", trackId: "remote_1" }),
    ];
    const events = [
      event({
        id: "ple_remote_1",
        remoteTrackRef: { driveId: "drv_1", shareId: "shr_1", trackId: "remote_1" },
        startedAt: NOW - 100,
      }),
      event({
        id: "ple_remote_2",
        remoteTrackRef: { driveId: "drv_1", shareId: "shr_1", trackId: "remote_1" },
        startedAt: NOW - 200,
      }),
    ];

    const rows = deriveMostPlayedPlaylist([], {
      events,
      now: NOW,
      range: "day",
      remoteTracks,
      stats: [],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        id: "remote:drv_1:shr_1:remote_1",
        kind: "remote-track",
        metric: expect.objectContaining({ playCount: 2 }),
      }),
    ]);
  });
});

function track(input: Partial<Track> & { id: string; title: string }): Track {
  const { id, title, ...rest } = input;
  return {
    blobId: `blb_${id}`,
    createdAt: NOW - 100_000,
    durationSec: 180,
    generatedAt: NOW - 100_000,
    id,
    kind: "audio",
    liked: false,
    origin: "uploaded",
    playCount: 0,
    provider: "upload",
    sessionId: "ses_1",
    status: "ready",
    tags: [],
    title,
    ...rest,
  };
}

function stat(input: Partial<TrackPlaybackStats> & { devicePublicId: string; trackId: string }) {
  return {
    id: `${input.devicePublicId}:${input.trackId}`,
    listenedSec: 0,
    playCount: 0,
    updatedAt: NOW,
    ...input,
  } satisfies TrackPlaybackStats;
}

function event(input: Partial<PlaybackEvent> & { id: string }): PlaybackEvent {
  return {
    context: { source: "local" },
    countedAsPlay: true,
    devicePublicId: "dvc_1",
    listenedSec: 30,
    startedAt: NOW,
    ...input,
  };
}

function remote(
  input: Partial<RemoteSearchTrack> & { driveId: string; id: string; trackId: string },
): RemoteSearchTrack {
  return {
    catalogId: "cat_1",
    durationSec: 180,
    kind: "audio",
    mediaAvailable: true,
    normalizedText: input.trackId,
    origin: "streamed",
    setIds: [],
    shareIds: input.shareId ? [input.shareId] : [],
    tags: [],
    title: input.trackId,
    updatedAt: NOW,
    ...input,
  };
}
