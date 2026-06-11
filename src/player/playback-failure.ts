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
