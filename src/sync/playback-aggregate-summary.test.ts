import { describe, expect, it } from "vitest";
import type { PlaybackAggregate } from "@/db/types";
import { summarizePlaybackAggregates } from "./playback-aggregate-summary";

describe("summarizePlaybackAggregates", () => {
  it("merges matching aggregate rows from multiple devices without losing device separation", () => {
    const rows: PlaybackAggregate[] = [
      aggregate({ devicePublicId: "dvc_a", playCount: 2, listenedSec: 120 }),
      aggregate({ devicePublicId: "dvc_b", playCount: 3, listenedSec: 180, lastPlayedAt: 2_000 }),
      aggregate({ devicePublicId: "dvc_c", trackId: "trk_other", playCount: 9, listenedSec: 900 }),
    ];

    expect(summarizePlaybackAggregates(rows, { scope: "track", trackId: "trk_1" })).toEqual({
      deviceCount: 2,
      listenedSec: 300,
      playCount: 5,
      lastPlayedAt: 2_000,
    });
  });

  it("keeps track-in-set play counts separate for the same track in different sets", () => {
    const rows: PlaybackAggregate[] = [
      aggregate({
        id: "dvc_a:track-in-set:ses_a:trk_1",
        scope: "track-in-set",
        setId: "ses_a",
        playCount: 2,
      }),
      aggregate({
        id: "dvc_a:track-in-set:ses_b:trk_1",
        scope: "track-in-set",
        setId: "ses_b",
        playCount: 7,
      }),
    ];

    expect(
      summarizePlaybackAggregates(rows, {
        scope: "track-in-set",
        setId: "ses_a",
        trackId: "trk_1",
      }).playCount,
    ).toBe(2);
    expect(
      summarizePlaybackAggregates(rows, {
        scope: "track-in-set",
        setId: "ses_b",
        trackId: "trk_1",
      }).playCount,
    ).toBe(7);
  });
});

function aggregate(overrides: Partial<PlaybackAggregate> = {}): PlaybackAggregate {
  return {
    id: "dvc_a:track:trk_1",
    devicePublicId: "dvc_a",
    scope: "track",
    trackId: "trk_1",
    playCount: 1,
    listenedSec: 60,
    lastPlayedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}
