import type { PlaybackEvent } from "@/db/types";

export interface PlaybackEventFlushPolicy {
  eventThreshold: number;
  maxAgeMs: number;
}

export interface ShouldFlushPlaybackEventSegmentInput extends Partial<PlaybackEventFlushPolicy> {
  events: PlaybackEvent[];
  mode: "auto" | "manual";
  now: number;
}

export const PLAYBACK_EVENT_FLUSH_LIMITS = {
  minEventThreshold: 25,
  maxEventThreshold: 100,
  minAgeMs: 5 * 60_000,
  maxAgeMs: 15 * 60_000,
} as const;

export const DEFAULT_PLAYBACK_EVENT_FLUSH_POLICY: PlaybackEventFlushPolicy = {
  eventThreshold: 50,
  maxAgeMs: 10 * 60_000,
};

export function shouldFlushPlaybackEventSegment(
  input: ShouldFlushPlaybackEventSegmentInput,
): boolean {
  if (input.events.length === 0) return false;
  if (input.mode === "manual") return true;

  const eventThreshold = clampInteger(
    input.eventThreshold ?? DEFAULT_PLAYBACK_EVENT_FLUSH_POLICY.eventThreshold,
    PLAYBACK_EVENT_FLUSH_LIMITS.minEventThreshold,
    PLAYBACK_EVENT_FLUSH_LIMITS.maxEventThreshold,
  );
  if (input.events.length >= eventThreshold) return true;

  const maxAgeMs = clampInteger(
    input.maxAgeMs ?? DEFAULT_PLAYBACK_EVENT_FLUSH_POLICY.maxAgeMs,
    PLAYBACK_EVENT_FLUSH_LIMITS.minAgeMs,
    PLAYBACK_EVENT_FLUSH_LIMITS.maxAgeMs,
  );
  const oldestStartedAt = Math.min(...input.events.map((event) => event.startedAt));
  return input.now - oldestStartedAt >= maxAgeMs;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
