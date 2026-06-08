import { describe, expect, it } from "vitest";
import type { PlaybackEvent } from "@/db/types";
import {
  DEFAULT_PLAYBACK_EVENT_FLUSH_POLICY,
  shouldFlushPlaybackEventSegment,
} from "./playback-event-segments";

function event(id: string, startedAt: number): PlaybackEvent {
  return {
    id,
    devicePublicId: "dvc_1",
    trackId: "trk_1",
    context: { source: "local", setId: "ses_1" },
    startedAt,
    endedAt: startedAt + 31_000,
    listenedSec: 31,
    countedAsPlay: true,
  };
}

describe("shouldFlushPlaybackEventSegment", () => {
  it("flushes automatically when pending event count reaches the configured threshold", () => {
    const events = Array.from(
      { length: DEFAULT_PLAYBACK_EVENT_FLUSH_POLICY.eventThreshold },
      (_, i) => event(`ple_${i}`, i),
    );

    expect(
      shouldFlushPlaybackEventSegment({
        events,
        mode: "auto",
        now: 60_000,
      }),
    ).toBe(true);
  });

  it("flushes automatically when oldest pending event reaches the time threshold", () => {
    expect(
      shouldFlushPlaybackEventSegment({
        events: [event("ple_1", 0)],
        mode: "auto",
        now: DEFAULT_PLAYBACK_EVENT_FLUSH_POLICY.maxAgeMs,
      }),
    ).toBe(true);
  });

  it("keeps custom thresholds inside the PRD safety bounds", () => {
    expect(
      shouldFlushPlaybackEventSegment({
        events: Array.from({ length: 24 }, (_, i) => event(`ple_${i}`, i)),
        eventThreshold: 10,
        mode: "auto",
        now: 1000,
      }),
    ).toBe(false);
    expect(
      shouldFlushPlaybackEventSegment({
        events: Array.from({ length: 25 }, (_, i) => event(`ple_${i}`, i)),
        eventThreshold: 10,
        mode: "auto",
        now: 1000,
      }),
    ).toBe(true);
    expect(
      shouldFlushPlaybackEventSegment({
        events: [event("ple_old", 0)],
        maxAgeMs: 60_000,
        mode: "auto",
        now: 4 * 60_000,
      }),
    ).toBe(false);
    expect(
      shouldFlushPlaybackEventSegment({
        events: [event("ple_old", 0)],
        maxAgeMs: 60_000,
        mode: "auto",
        now: 5 * 60_000,
      }),
    ).toBe(true);
  });

  it("allows manual sync to flush a small pending segment", () => {
    expect(
      shouldFlushPlaybackEventSegment({
        events: [event("ple_1", 1000)],
        mode: "manual",
        now: 2000,
      }),
    ).toBe(true);
  });

  it("does not flush an empty pending segment", () => {
    expect(
      shouldFlushPlaybackEventSegment({
        events: [],
        mode: "manual",
        now: 2000,
      }),
    ).toBe(false);
  });
});
