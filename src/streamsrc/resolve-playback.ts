/**
 * Resolve a streamed track to a playable URL just before playback — the seam the
 * player calls. Kept pure + injectable (no store/bridge import) so it's unit-
 * testable; the player wires `resolveSource` from the registry + on-device settings.
 *
 * Streamed URLs are short-lived, so this runs per play (not stored). NetEase URLs
 * play directly in <audio>; Bilibili URLs carry `headers` (Referer) the media proxy
 * must inject — passed through here for the player to route once that's wired.
 */

import type { StreamSourceId } from "@/db/types";
import type { StreamSourceProvider } from "./provider";

export interface StreamedTrackRef {
  streamSourceId?: StreamSourceId;
  streamExternalId?: string;
}

export interface ResolveStreamedDeps {
  /** Build/lookup the provider for a source (registry-backed in the player). */
  resolveSource: (id: StreamSourceId) => StreamSourceProvider | null;
  /** Preferred per-source quality key from settings. */
  getQuality?: (id: StreamSourceId) => string | undefined;
  signal?: AbortSignal;
}

export type StreamPlaybackResult =
  | { kind: "ok"; url: string; mime: string; headers?: Record<string, string>; quality?: string }
  | { kind: "requires-login"; source: StreamSourceId }
  | { kind: "no-permission"; source: StreamSourceId; reason: string }
  | { kind: "error"; message: string };

/** Resolve a streamed track's current playable media, mapping provider verdicts. */
export async function resolveStreamedTrackMedia(
  track: StreamedTrackRef,
  deps: ResolveStreamedDeps,
): Promise<StreamPlaybackResult> {
  const { streamSourceId, streamExternalId } = track;
  if (!streamSourceId || !streamExternalId) {
    return { kind: "error", message: "track has no stream source ref" };
  }
  const source = deps.resolveSource(streamSourceId);
  if (!source) {
    return { kind: "error", message: `stream source "${streamSourceId}" unavailable` };
  }
  const res = await source.resolve(streamExternalId, {
    quality: deps.getQuality?.(streamSourceId),
    signal: deps.signal,
  });
  switch (res.kind) {
    case "ok":
      return {
        kind: "ok",
        url: res.stream.mediaUrl,
        mime: res.stream.mime,
        headers: res.stream.headers,
        quality: res.stream.quality,
      };
    case "requires-login":
      return { kind: "requires-login", source: streamSourceId };
    case "no-permission":
      return { kind: "no-permission", source: streamSourceId, reason: res.reason };
    default:
      return { kind: "error", message: res.message };
  }
}
