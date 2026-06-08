import type { PlaybackEvent } from "@/db/types";

export interface PlaybackListenSample {
  trackId: string;
  positionSec: number;
  durationSec: number;
  now: number;
  context: PlaybackEvent["context"];
}

export interface PlaybackListenFlush {
  trackId: string;
  durationSec: number;
  listenedSec: number;
  startedAt: number;
  endedAt: number;
  context: PlaybackEvent["context"];
}

export interface PlaybackListenTracker {
  update: (sample: PlaybackListenSample) => PlaybackListenFlush | null;
  flush: (now: number) => PlaybackListenFlush | null;
}

interface ActiveListen {
  trackId: string;
  durationSec: number;
  listenedSec: number;
  startedAt: number;
  lastPositionSec: number;
  context: PlaybackEvent["context"];
}

export function createPlaybackListenTracker(
  options: { maxDeltaSec?: number } = {},
): PlaybackListenTracker {
  const maxDeltaSec = options.maxDeltaSec ?? 5;
  let active: ActiveListen | null = null;

  function flush(now: number): PlaybackListenFlush | null {
    if (!active) return null;
    const result: PlaybackListenFlush = {
      trackId: active.trackId,
      durationSec: active.durationSec,
      listenedSec: Math.max(0, Math.round(active.listenedSec)),
      startedAt: active.startedAt,
      endedAt: now,
      context: active.context,
    };
    active = null;
    return result;
  }

  function update(sample: PlaybackListenSample): PlaybackListenFlush | null {
    let previous: PlaybackListenFlush | null = null;
    if (!active || active.trackId !== sample.trackId) {
      previous = flush(sample.now);
      active = {
        trackId: sample.trackId,
        durationSec: sample.durationSec,
        listenedSec: 0,
        startedAt: sample.now,
        lastPositionSec: sample.positionSec,
        context: sample.context,
      };
      return previous;
    }

    const delta = sample.positionSec - active.lastPositionSec;
    if (delta > 0 && delta <= maxDeltaSec) {
      active.listenedSec += delta;
    }
    active.durationSec = sample.durationSec || active.durationSec;
    active.lastPositionSec = sample.positionSec;
    active.context = sample.context;
    return previous;
  }

  return { update, flush };
}
