import { describe, expect, it } from "vitest";
import type { PlaybackAggregate, PlaybackEvent, SyncObject } from "@/db/types";
import { summarizePlaybackSyncState } from "./playback-sync-summary";

describe("summarizePlaybackSyncState", () => {
  it("separates pending local listens from uploaded stats segments and aggregate totals", () => {
    const summary = summarizePlaybackSyncState({
      devicePublicId: "dvc_1",
      events: [
        event({ id: "evt_old", startedAt: 1_000, listenedSec: 45 }),
        event({ id: "evt_new", startedAt: 3_000, listenedSec: 75 }),
      ],
      aggregates: [aggregate({ playCount: 2, listenedSec: 120 })],
      syncObjects: [
        syncObject({
          key: "stats/events/dvc_1/1000-1000-abcdef0123456789.json",
          kind: "stats-events-segment",
          lastUploadedAt: 2_000,
        }),
        syncObject({
          key: "stats/devices/dvc_1/checkpoint.json",
          kind: "stats-checkpoint",
          lastUploadedAt: 2_000,
        }),
      ],
    });

    expect(summary).toEqual({
      aggregateListenedSec: 120,
      aggregatePlayCount: 2,
      pendingEventCount: 1,
      pendingListenedSec: 75,
      uploadedSegmentCount: 1,
      uploadedThrough: 2_000,
    });
  });

  it("keeps another anonymous device out of the local pending summary", () => {
    const summary = summarizePlaybackSyncState({
      devicePublicId: "dvc_1",
      events: [
        event({ id: "evt_local", devicePublicId: "dvc_1", startedAt: 3_000 }),
        event({ id: "evt_other", devicePublicId: "dvc_2", startedAt: 4_000, listenedSec: 300 }),
      ],
      aggregates: [
        aggregate({ devicePublicId: "dvc_1", playCount: 1 }),
        aggregate({ devicePublicId: "dvc_2", playCount: 9, listenedSec: 900 }),
      ],
      syncObjects: [
        syncObject({
          key: "stats/events/dvc_2/1000-1000-abcdef0123456789.json",
          kind: "stats-events-segment",
          lastUploadedAt: 5_000,
        }),
      ],
    });

    expect(summary.pendingEventCount).toBe(1);
    expect(summary.pendingListenedSec).toBe(60);
    expect(summary.uploadedSegmentCount).toBe(0);
    expect(summary.aggregatePlayCount).toBe(1);
  });
});

function event(overrides: Partial<PlaybackEvent> = {}): PlaybackEvent {
  return {
    id: "evt_1",
    devicePublicId: "dvc_1",
    trackId: "trk_1",
    context: { source: "local" },
    startedAt: 1_000,
    endedAt: 1_060,
    listenedSec: 60,
    countedAsPlay: true,
    ...overrides,
  };
}

function aggregate(overrides: Partial<PlaybackAggregate> = {}): PlaybackAggregate {
  return {
    id: "dvc_1:track:trk_1",
    devicePublicId: "dvc_1",
    scope: "track",
    trackId: "trk_1",
    playCount: 1,
    listenedSec: 60,
    lastPlayedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function syncObject(overrides: Partial<SyncObject> = {}): SyncObject {
  return {
    id: "drv_1:stats/events/dvc_1/1000-1000-abcdef0123456789.json",
    driveId: "drv_1",
    key: "stats/events/dvc_1/1000-1000-abcdef0123456789.json",
    kind: "stats-events-segment",
    contentType: "application/json",
    bytes: 128,
    updatedAt: 2_000,
    ...overrides,
  };
}
