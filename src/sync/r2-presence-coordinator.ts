import type { R2Presence } from "./r2-presence";
import { shouldWritePresence, toR2Presence } from "./r2-presence";

export interface PresenceTrackSnapshot {
  trackId?: string;
  setId?: string;
  positionSec?: number;
}

export interface R2PresenceCoordinatorOptions {
  devicePublicId: string;
  deviceName?: string;
  ttlMs?: number;
  now?: () => number;
  writePresence: (presence: R2Presence) => Promise<void>;
}

export interface R2PresenceCoordinator {
  trackStarted: (snapshot: PresenceTrackSnapshot) => Promise<void>;
  trackChanged: (snapshot: PresenceTrackSnapshot) => Promise<void>;
  paused: (snapshot?: Pick<PresenceTrackSnapshot, "positionSec">) => Promise<void>;
  resumed: (snapshot?: Pick<PresenceTrackSnapshot, "positionSec">) => Promise<void>;
  stopped: (snapshot?: Pick<PresenceTrackSnapshot, "positionSec">) => Promise<void>;
  heartbeat: (snapshot?: Pick<PresenceTrackSnapshot, "positionSec">) => Promise<void>;
  current: () => R2Presence | null;
}

export function createR2PresenceCoordinator(
  options: R2PresenceCoordinatorOptions,
): R2PresenceCoordinator {
  let latest: R2Presence | null = null;
  let currentTrack: PresenceTrackSnapshot = {};

  async function publish(
    state: R2Presence["state"],
    snapshot: PresenceTrackSnapshot = {},
  ): Promise<void> {
    currentTrack = {
      ...currentTrack,
      ...snapshot,
    };
    const input = {
      devicePublicId: options.devicePublicId,
      deviceName: options.deviceName,
      trackId: currentTrack.trackId,
      setId: currentTrack.setId,
      state,
      positionSec: snapshot.positionSec ?? currentTrack.positionSec,
      now: options.now?.() ?? Date.now(),
      ttlMs: options.ttlMs,
    };
    if (!shouldWritePresence(latest, input)) return;

    const next = toR2Presence(input);
    await options.writePresence(next);
    latest = next;
  }

  return {
    trackStarted: (snapshot) => publish("playing", snapshot),
    trackChanged: (snapshot) => publish("playing", snapshot),
    paused: (snapshot) => publish("paused", snapshot),
    resumed: (snapshot) => publish("playing", snapshot),
    stopped: (snapshot) => publish("stopped", snapshot),
    heartbeat: (snapshot) => publish(latest?.state ?? "playing", snapshot),
    current: () => latest,
  };
}
