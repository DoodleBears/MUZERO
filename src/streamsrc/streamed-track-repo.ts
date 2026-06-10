/**
 * Create + dedupe `origin: "streamed"` tracks. Kept out of `db/repositories.ts`
 * (which is being concurrently edited) — it only depends on the db handle + id
 * helper, so a separate module is clean.
 *
 * A streamed track stores the source ref (`streamSourceId` + `streamExternalId`)
 * and a display snapshot, NOT audio bytes — those are resolved on demand at play
 * time (and optionally cached to a blob in Phase 5). The cover is a remote URL.
 */

import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { StreamSourceId, StreamSourceMeta, Track, TrackKind } from "@/db/types";
import { newId } from "@/lib/id";
import type { StreamSearchHit } from "./provider";

export interface CreateStreamedTrackInput {
  sessionId: string;
  sourceId: StreamSourceId;
  externalId: string;
  title: string;
  kind?: TrackKind;
  /** Remote cover URL (shown via `remoteCoverUrl` until/unless cached). */
  coverUrl?: string;
  meta?: StreamSourceMeta;
}

/** Map a search hit into the input for {@link createStreamedTrack}. */
export function hitToStreamedInput(
  sessionId: string,
  hit: StreamSearchHit,
): CreateStreamedTrackInput {
  return {
    sessionId,
    sourceId: hit.source,
    externalId: hit.externalId,
    title: hit.title,
    kind: "audio",
    coverUrl: hit.coverUrl,
    meta: {
      artist: hit.artist,
      album: hit.album,
      coverUrl: hit.coverUrl,
      durationSec: hit.durationSec,
    },
  };
}

/** Find an existing streamed track for (session, source, externalId). Non-indexed scan. */
export async function findStreamedTrack(
  sessionId: string,
  sourceId: StreamSourceId,
  externalId: string,
  db: MuzeroDB = defaultDb,
): Promise<Track | undefined> {
  return db.tracks
    .where("sessionId")
    .equals(sessionId)
    .filter(
      (t) =>
        t.origin === "streamed" &&
        t.streamSourceId === sourceId &&
        t.streamExternalId === externalId,
    )
    .first();
}

/**
 * Create a streamed track in a session, or return the existing one if the same
 * external track was already added (dedupe by source + externalId within the set).
 */
export async function createStreamedTrack(
  input: CreateStreamedTrackInput,
  db: MuzeroDB = defaultDb,
): Promise<Track> {
  const existing = await findStreamedTrack(input.sessionId, input.sourceId, input.externalId, db);
  if (existing) return existing;

  const track: Track = {
    id: newId("trk"),
    sessionId: input.sessionId,
    title: input.title,
    kind: input.kind ?? "audio",
    origin: "streamed",
    provider: input.sourceId,
    status: "ready",
    durationSec: input.meta?.durationSec ?? 0,
    createdAt: Date.now(),
    playCount: 0,
    liked: false,
    tags: [],
    streamSourceId: input.sourceId,
    streamExternalId: input.externalId,
    streamMeta: input.meta,
    remoteCoverUrl: input.coverUrl,
  };
  await db.tracks.put(track);
  return track;
}
