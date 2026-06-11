import type { Track } from "@/db/types";

export function isCloudMetadataOnlyStreamTrack(
  track: Pick<Track, "blobId" | "cloudSource" | "origin" | "remoteMediaUrl">,
): boolean {
  return (
    track.origin === "streamed" &&
    !track.blobId &&
    !track.remoteMediaUrl &&
    Boolean(track.cloudSource)
  );
}

export function streamResolveFailureNotificationLevel(
  track: Pick<Track, "blobId" | "cloudSource" | "origin" | "remoteMediaUrl">,
  needsSourceAccess: boolean,
): "warning" | "error" {
  return needsSourceAccess || isCloudMetadataOnlyStreamTrack(track) ? "warning" : "error";
}

export interface StreamSkipRunDecision {
  failedTrackIds: Set<string>;
  firstFailureInRun: boolean;
  shouldTryNext: boolean;
}

export function recordStreamSkipFailure(
  previousFailedTrackIds: ReadonlySet<string>,
  trackId: string,
  queueLength: number,
  maxSkips: number,
): StreamSkipRunDecision {
  const failedTrackIds = new Set(previousFailedTrackIds);
  const firstFailureInRun = failedTrackIds.size === 0;
  failedTrackIds.add(trackId);
  const boundedQueueLength = Math.max(1, queueLength);
  const scannedWholeQueue = failedTrackIds.size >= Math.min(boundedQueueLength, maxSkips);
  return {
    failedTrackIds,
    firstFailureInRun,
    shouldTryNext: !scannedWholeQueue,
  };
}
