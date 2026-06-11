import type { Track } from "@/db/types";

export type TrackMediaSourceKind =
  | "local-file"
  | "local-stream-cache"
  | "r2-file"
  | "url"
  | "stream"
  | "missing";

export type TrackCoverSourceKind = "local-cover" | "r2-cover" | "url" | "missing";

export interface TrackSourceSummary {
  kind: TrackMediaSourceKind | TrackCoverSourceKind;
  labelKey: string;
  params?: Record<string, string>;
  host?: string;
}

type TrackMediaSourceFields = {
  blobId?: Track["blobId"];
  cloudSource?: Track["cloudSource"];
  origin?: Track["origin"];
  provider?: Track["provider"];
  remoteMediaUrl?: Track["remoteMediaUrl"];
  streamSourceId?: Track["streamSourceId"];
  streamExternalId?: Track["streamExternalId"];
};

type TrackCoverSourceFields = {
  cloudSource?: Track["cloudSource"];
  coverBlobId?: Track["coverBlobId"];
  remoteCoverUrl?: Track["remoteCoverUrl"];
};

export function describeTrackMediaSource(track: TrackMediaSourceFields): TrackSourceSummary {
  if (track.blobId) {
    return track.origin === "streamed"
      ? { kind: "local-stream-cache", labelKey: "gallery.trackSourceLocalStreamCache" }
      : { kind: "local-file", labelKey: "gallery.trackSourceLocalFile" };
  }
  if (track.remoteMediaUrl) {
    const host = urlHost(track.remoteMediaUrl);
    return isR2BackedUrl(track.remoteMediaUrl, Boolean(track.cloudSource))
      ? {
          kind: "r2-file",
          labelKey: "gallery.trackSourceR2File",
          params: { source: cloudSourceName(track) },
          host,
        }
      : { kind: "url", labelKey: "gallery.trackSourceUrl", host };
  }
  if (track.origin === "streamed" && track.streamSourceId && track.streamExternalId) {
    return {
      kind: "stream",
      labelKey: "gallery.trackSourceStream",
      params: { source: track.streamSourceId ?? track.provider },
    };
  }
  return { kind: "missing", labelKey: "gallery.trackSourceMissing" };
}

export function describeTrackCoverSource(track: TrackCoverSourceFields): TrackSourceSummary {
  if (track.coverBlobId) return { kind: "local-cover", labelKey: "gallery.trackCoverLocal" };
  if (track.remoteCoverUrl) {
    const host = urlHost(track.remoteCoverUrl);
    return isR2BackedUrl(track.remoteCoverUrl, Boolean(track.cloudSource))
      ? {
          kind: "r2-cover",
          labelKey: "gallery.trackCoverR2",
          params: { source: cloudSourceName(track) },
          host,
        }
      : { kind: "url", labelKey: "gallery.trackCoverUrl", host };
  }
  return { kind: "missing", labelKey: "gallery.trackCoverMissing" };
}

function isR2BackedUrl(url: string, hasCloudSource: boolean): boolean {
  const host = urlHost(url);
  if (host.endsWith(".r2.cloudflarestorage.com") || host.endsWith(".r2.dev")) return true;
  return hasCloudSource && safeUrlPath(url).includes("/objects/");
}

function cloudSourceName(track: Pick<Track, "cloudSource">): string {
  return (
    track.cloudSource?.driveLabel ??
    track.cloudSource?.displayName ??
    track.cloudSource?.driveId ??
    "R2"
  );
}

function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function safeUrlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
