import type { PlaybackAggregate, PlaybackEvent, SyncObject } from "@/db/types";
import { summarizePlaybackAggregates } from "./playback-aggregate-summary";

export interface PlaybackSyncStateInput {
  devicePublicId?: string;
  events: PlaybackEvent[];
  aggregates: PlaybackAggregate[];
  syncObjects: SyncObject[];
}

export interface PlaybackSyncStateSummary {
  aggregateListenedSec: number;
  aggregatePlayCount: number;
  pendingEventCount: number;
  pendingListenedSec: number;
  uploadedSegmentCount: number;
  uploadedThrough?: number;
}

export function summarizePlaybackSyncState(
  input: PlaybackSyncStateInput,
): PlaybackSyncStateSummary {
  const events = input.events.filter((event) => matchesDevice(event.devicePublicId, input));
  const aggregates = input.aggregates.filter((aggregate) =>
    matchesDevice(aggregate.devicePublicId, input),
  );
  const syncObjects = input.syncObjects.filter((object) => matchesStatsObjectDevice(object, input));
  const uploadedThrough = latestCheckpointUploadTime(syncObjects);
  const pendingEvents = events.filter(
    (event) => uploadedThrough == null || event.startedAt > uploadedThrough,
  );
  const aggregateSummary = summarizePlaybackAggregates(aggregates, { scope: "track" });

  return {
    aggregateListenedSec: aggregateSummary.listenedSec,
    aggregatePlayCount: aggregateSummary.playCount,
    pendingEventCount: pendingEvents.length,
    pendingListenedSec: pendingEvents.reduce((sum, event) => sum + event.listenedSec, 0),
    uploadedSegmentCount: syncObjects.filter((object) => object.kind === "stats-events-segment")
      .length,
    uploadedThrough,
  };
}

function latestCheckpointUploadTime(syncObjects: SyncObject[]): number | undefined {
  let latest: number | undefined;
  for (const object of syncObjects) {
    if (object.kind !== "stats-checkpoint") continue;
    const uploadedAt = object.lastUploadedAt ?? object.updatedAt;
    latest = Math.max(latest ?? uploadedAt, uploadedAt);
  }
  return latest;
}

function matchesDevice(value: string, input: PlaybackSyncStateInput): boolean {
  return input.devicePublicId == null || value === input.devicePublicId;
}

function matchesStatsObjectDevice(object: SyncObject, input: PlaybackSyncStateInput): boolean {
  if (input.devicePublicId == null) return isStatsSyncObject(object);
  return isStatsSyncObject(object) && object.key.includes(`/${input.devicePublicId}/`);
}

function isStatsSyncObject(object: SyncObject): boolean {
  return object.kind === "stats-events-segment" || object.kind === "stats-checkpoint";
}
