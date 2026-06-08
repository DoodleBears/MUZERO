import { describe, expect, it } from "vitest";
import { createPlaybackListenTracker } from "./playback-listen-session";

describe("playback listen tracker", () => {
  it("accumulates forward playback time and flushes listened seconds", () => {
    const tracker = createPlaybackListenTracker({ maxDeltaSec: 30 });

    tracker.update({
      trackId: "trk_1",
      positionSec: 0,
      durationSec: 180,
      now: 1000,
      context: { source: "local", setId: "ses_1" },
    });
    tracker.update({
      trackId: "trk_1",
      positionSec: 10,
      durationSec: 180,
      now: 11_000,
      context: { source: "local", setId: "ses_1" },
    });

    expect(tracker.flush(11_000)).toMatchObject({
      trackId: "trk_1",
      listenedSec: 10,
      startedAt: 1000,
      endedAt: 11_000,
    });
  });

  it("ignores large seek jumps", () => {
    const tracker = createPlaybackListenTracker({ maxDeltaSec: 5 });

    tracker.update({
      trackId: "trk_1",
      positionSec: 20,
      durationSec: 180,
      now: 1000,
      context: { source: "local" },
    });
    tracker.update({
      trackId: "trk_1",
      positionSec: 120,
      durationSec: 180,
      now: 2000,
      context: { source: "local" },
    });

    expect(tracker.flush(2000)?.listenedSec).toBe(0);
  });

  it("does not bridge paused time when playback resumes", () => {
    const tracker = createPlaybackListenTracker({ maxDeltaSec: 30 });

    tracker.update({
      trackId: "trk_1",
      positionSec: 0,
      durationSec: 180,
      now: 1000,
      context: { source: "local" },
    });
    tracker.update({
      trackId: "trk_1",
      positionSec: 10,
      durationSec: 180,
      now: 11_000,
      context: { source: "local" },
    });
    expect(tracker.flush(11_000)).toMatchObject({
      listenedSec: 10,
      trackId: "trk_1",
    });

    tracker.update({
      trackId: "trk_1",
      positionSec: 10,
      durationSec: 180,
      now: 71_000,
      context: { source: "local" },
    });
    tracker.update({
      trackId: "trk_1",
      positionSec: 15,
      durationSec: 180,
      now: 76_000,
      context: { source: "local" },
    });

    expect(tracker.flush(76_000)).toMatchObject({
      listenedSec: 5,
      startedAt: 71_000,
      trackId: "trk_1",
    });
  });

  it("flushes the previous track when the active track changes", () => {
    const tracker = createPlaybackListenTracker();

    tracker.update({
      trackId: "trk_1",
      positionSec: 0,
      durationSec: 180,
      now: 1000,
      context: { source: "local" },
    });
    const flushed = tracker.update({
      trackId: "trk_2",
      positionSec: 0,
      durationSec: 90,
      now: 6000,
      context: { source: "local" },
    });

    expect(flushed).toMatchObject({ trackId: "trk_1", listenedSec: 0, endedAt: 6000 });
    expect(tracker.flush(7000)).toMatchObject({ trackId: "trk_2" });
  });

  it("flushes the active listening window on app close", () => {
    const tracker = createPlaybackListenTracker({ maxDeltaSec: 30 });

    tracker.update({
      trackId: "trk_1",
      positionSec: 0,
      durationSec: 180,
      now: 1000,
      context: { source: "local" },
    });
    tracker.update({
      trackId: "trk_1",
      positionSec: 12,
      durationSec: 180,
      now: 13_000,
      context: { source: "local" },
    });

    expect(tracker.flush(20_000)).toMatchObject({
      endedAt: 20_000,
      listenedSec: 12,
      startedAt: 1000,
      trackId: "trk_1",
    });
    expect(tracker.flush(21_000)).toBeNull();
  });
});
