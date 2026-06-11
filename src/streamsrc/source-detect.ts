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

/** Which media the player should load, highest-priority first. */
export type PlaybackSourceKind = "blob" | "remote" | "stream" | "none";

type PlaybackFields = StreamFields & Pick<Track, "blobId" | "remoteMediaUrl">;

/**
 * Pick a track's playback source in strict priority order — **local first**:
 *  1. `blob`   — locally-stored bytes (`blobId`): generated/uploaded tracks, OR a
 *               downloaded streamed track. Plays offline; NEVER hits the network.
 *  2. `remote` — a `remoteMediaUrl` (read-only cloud share).
 *  3. `stream` — an external source resolved per play (online round-trip).
 *  4. `none`   — nothing playable yet.
 *
 * `blob` outranking `stream` is the guarantee that a cached streamed track plays
 * from disk and never re-resolves online — see {@link isStreamedTrackCached}.
 */
export function playbackSourceKind(track: PlaybackFields): PlaybackSourceKind {
  if (track.blobId) return "blob";
  if (track.remoteMediaUrl) return "remote";
  if (isStreamedTrack(track)) return "stream";
  return "none";
}
