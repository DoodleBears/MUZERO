import { describe, expect, it } from "vitest";
import type { DjSession, PlaybackAggregate, PlaybackEvent, Track } from "@/db/types";
import { DEFAULT_DJ_CONFIG } from "@/db/types";
import { summarizeListeningStats } from "./listening-stats-summary";

const now = Date.UTC(2026, 5, 13);

function track(id: string, title: string, tags: string[] = []): Track {
  return {
    id,
    sessionId: "ses_a",
    title,
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 180,
    playCount: 0,
    liked: false,
    tags,
    createdAt: now,
  };
}

function session(id: string, name: string): DjSession {
  return {
    id,
    name,
    seedPrompt: "",
    trackIds: [],
    status: "idle",
    config: { ...DEFAULT_DJ_CONFIG, autoExtend: false },
    displayMode: "cover",
    createdAt: now,
    updatedAt: now,
  };
}

function event(input: Partial<PlaybackEvent> & { id: string; trackId: string }): PlaybackEvent {
  return {
    devicePublicId: "dev_a",
    context: { source: "local", setId: "ses_a" },
    countedAsPlay: true,
    listenedSec: 60,
    startedAt: now,
    ...input,
  };
}

function aggregate(input: Partial<PlaybackAggregate> & { id: string }): PlaybackAggregate {
  return {
    devicePublicId: "dev_a",
    scope: "track",
    playCount: 0,
    listenedSec: 0,
    updatedAt: now,
    ...input,
  };
}

describe("summarizeListeningStats", () => {
  it("returns an empty local-first summary when no listening data exists", () => {
    const summary = summarizeListeningStats({
      tracks: [],
      sessions: [],
      aggregates: [],
      events: [],
      sync: { pendingEventCount: 0, pendingListenedSec: 0, uploadedSegmentCount: 0 },
      range: "all",
      now,
    });

    expect(summary.playCount).toBe(0);
    expect(summary.listenedSec).toBe(0);
    expect(summary.topTracksByTime).toEqual([]);
    expect(summary.recentlyPlayed).toEqual([]);
  });

  it("builds all-time ranked tracks, sets, tags, and recent plays", () => {
    const summary = summarizeListeningStats({
      tracks: [track("trk_a", "Alpha", ["focus"]), track("trk_b", "Beta", ["focus", "run"])],
      sessions: [session("ses_a", "Morning")],
      aggregates: [
        aggregate({ id: "agg_a", trackId: "trk_a", playCount: 2, listenedSec: 200 }),
        aggregate({ id: "agg_b", trackId: "trk_b", playCount: 5, listenedSec: 120 }),
        aggregate({ id: "agg_set", scope: "set", setId: "ses_a", playCount: 7, listenedSec: 320 }),
      ],
      events: [
        event({ id: "evt_old", trackId: "trk_a", startedAt: now - 2_000, listenedSec: 10 }),
        event({ id: "evt_new", trackId: "trk_b", startedAt: now - 1_000, listenedSec: 20 }),
      ],
      sync: { pendingEventCount: 1, pendingListenedSec: 20, uploadedSegmentCount: 2 },
      range: "all",
      now,
    });

    expect(summary.playCount).toBe(7);
    expect(summary.listenedSec).toBe(320);
    expect(summary.uniqueTrackCount).toBe(2);
    expect(summary.topTracksByTime.map((item) => item.label)).toEqual(["Alpha", "Beta"]);
    expect(summary.topTracksByPlays.map((item) => item.label)).toEqual(["Beta", "Alpha"]);
    expect(summary.topSets.map((item) => item.label)).toEqual(["Morning"]);
    expect(summary.topTags.map((item) => item.tag)).toEqual(["focus", "run"]);
    expect(summary.recentlyPlayed.map((item) => item.label)).toEqual(["Beta", "Alpha"]);
    expect(summary.pendingEventCount).toBe(1);
    expect(summary.uploadedSegmentCount).toBe(2);
  });

  it("uses events for finite time ranges", () => {
    const summary = summarizeListeningStats({
      tracks: [track("trk_a", "Alpha"), track("trk_b", "Beta")],
      sessions: [session("ses_a", "Morning")],
      aggregates: [aggregate({ id: "agg_a", trackId: "trk_a", playCount: 99, listenedSec: 999 })],
      events: [
        event({ id: "evt_old", trackId: "trk_a", startedAt: now - 40 * 24 * 60 * 60 * 1000 }),
        event({ id: "evt_recent", trackId: "trk_b", startedAt: now - 2 * 24 * 60 * 60 * 1000 }),
      ],
      sync: { pendingEventCount: 0, pendingListenedSec: 0, uploadedSegmentCount: 0 },
      range: "7d",
      now,
    });

    expect(summary.playCount).toBe(1);
    expect(summary.listenedSec).toBe(60);
    expect(summary.topTracksByTime.map((item) => item.label)).toEqual(["Beta"]);
    expect(summary.activeDayCount).toBe(1);
  });
});
