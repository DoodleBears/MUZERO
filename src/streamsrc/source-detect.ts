/**
 * Route a Track to its streaming source — pure. Unlike NeriPlayer's `channelId`/
 * `album`-prefix heuristics, MUZERO stores an explicit `streamSourceId`, so this is
 * just a typed read. The player uses it to pick the right provider before playback
 * (mirrors the `when{ isYouTube / isBili / else }` dispatch, but data-driven).
 */

import type { StreamSourceId, Track } from "@/db/types";

type StreamFields = Pick<Track, "origin" | "streamSourceId" | "streamExternalId">;

/** The source id for a streamed track, or null for generated/uploaded/underspecified. */
export function detectStreamSource(track: StreamFields): StreamSourceId | null {
  if (track.origin !== "streamed") return null;
  return track.streamSourceId ?? null;
}

/** Whether a track is a fully-specified streamed track (resolvable to a playable URL). */
export function isStreamedTrack(
  track: StreamFields,
): track is StreamFields & { streamSourceId: StreamSourceId; streamExternalId: string } {
  return (
    track.origin === "streamed" &&
    typeof track.streamSourceId === "string" &&
    typeof track.streamExternalId === "string" &&
    track.streamExternalId.length > 0
  );
}
