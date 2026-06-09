import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { DjSession, EntityCover, Memory, SetDisplayMode, Track } from "@/db/types";
import type { R2EntityCoversIndex } from "./r2-manifest-schema";
import type { RemoteSetIndexResult } from "./r2-subscription";
import { resolveRemoteObjectUrl } from "./r2-url";

export interface ImportRemoteSetStreamInput {
  driveId: string;
  shareId?: string;
  remoteSet: RemoteSetIndexResult;
}

export interface ImportRemoteSetStreamResult {
  sessionId: string;
  trackIds: string[];
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function remoteLocalId(prefix: "ses" | "trk" | "mem", driveId: string, remoteId: string): string {
  return `${prefix}_remote_${safeIdPart(driveId)}_${safeIdPart(remoteId)}`;
}

function remoteTrackIdPrefix(driveId: string): string {
  return `trk_remote_${safeIdPart(driveId)}_`;
}

function mergeRemoteAndLocalOnlyTrackIds(
  remoteTrackIds: string[],
  existingTrackIds: string[] | undefined,
  driveId: string,
): string[] {
  if (!existingTrackIds || existingTrackIds.length === 0) return remoteTrackIds;
  const remoteIds = new Set(remoteTrackIds);
  const remotePrefix = remoteTrackIdPrefix(driveId);
  const localOnlyIds = existingTrackIds.filter(
    (trackId) => !trackId.startsWith(remotePrefix) && !remoteIds.has(trackId),
  );
  return [...remoteTrackIds, ...localOnlyIds];
}

function normalizeDisplayMode(
  mode: RemoteSetIndexResult["index"]["set"]["displayMode"],
): SetDisplayMode {
  return mode === "title" ? "cover" : mode;
}

export async function importRemoteSetStream(
  input: ImportRemoteSetStreamInput,
  db: MuzeroDB = defaultDb,
): Promise<ImportRemoteSetStreamResult> {
  const { driveId, remoteSet } = input;
  const sessionId = remoteLocalId("ses", driveId, remoteSet.index.set.id);
  const remoteTrackIds = remoteSet.tracks.map((track) => remoteLocalId("trk", driveId, track.id));
  const existingSession = await db.sessions.get(sessionId);
  const trackIds = mergeRemoteAndLocalOnlyTrackIds(
    remoteTrackIds,
    existingSession?.trackIds,
    driveId,
  );
  const session: DjSession = {
    id: sessionId,
    name: remoteSet.index.set.name,
    description: remoteSet.index.set.description,
    seedPrompt: remoteSet.index.set.seedPrompt,
    trackIds,
    status: "idle",
    config: remoteSet.index.set.config,
    displayMode: normalizeDisplayMode(remoteSet.index.set.displayMode),
    createdAt: remoteSet.index.set.createdAt,
    updatedAt: remoteSet.index.set.updatedAt,
  };

  const tracks: Track[] = remoteSet.tracks.map((remoteTrack) => ({
    id: remoteLocalId("trk", driveId, remoteTrack.id),
    sessionId,
    title: remoteTrack.source.title,
    kind: remoteTrack.source.kind,
    origin: remoteTrack.source.origin,
    brief: remoteTrack.source.brief ?? undefined,
    provider: remoteTrack.source.provider,
    providerPreset: remoteTrack.source.providerPreset ?? undefined,
    status: "ready",
    durationSec: remoteTrack.source.durationSec,
    remoteMediaUrl: remoteTrack.mediaUrl,
    remoteCoverUrl: remoteTrack.coverUrl,
    createdAt: remoteTrack.source.createdAt,
    generatedAt: remoteTrack.source.generatedAt ?? undefined,
    playCount: 0,
    liked: remoteTrack.source.liked,
    tags: remoteTrack.source.tags,
    mediaMetadata: remoteTrack.source.mediaMetadata,
  }));

  const memories: Memory[] = remoteSet.tracks.flatMap((remoteTrack) => {
    const trackId = remoteLocalId("trk", driveId, remoteTrack.id);
    return (remoteTrack.source.memories ?? []).map((memory) => ({
      id: remoteLocalId("mem", driveId, memory.id),
      trackId,
      note: memory.note,
      author: memory.author,
      remotePhotoUrl: remoteTrack.memoryPhotoUrls.find((photo) => photo.memoryId === memory.id)
        ?.url,
      createdAt: memory.createdAt,
    }));
  });

  await db.transaction("rw", db.sessions, db.tracks, db.memories, async () => {
    await db.sessions.put(session);
    await db.tracks.bulkPut(tracks);
    if (memories.length > 0) await db.memories.bulkPut(memories);
  });

  return { sessionId, trackIds: remoteTrackIds };
}

/**
 * Last-write-wins for an entity cover: the remote wins when there's no local
 * cover or the remote clock is strictly newer. A tie keeps the local (the bytes
 * are content-addressed, so a same-clock cover is the same image).
 */
export function entityCoverRemoteWins(
  localUpdatedAt: number | undefined,
  remoteUpdatedAt: number,
): boolean {
  return localUpdatedAt == null || remoteUpdatedAt > localUpdatedAt;
}

export interface ImportRemoteEntityCoversInput {
  baseUrl: string;
  index: R2EntityCoversIndex;
}

/**
 * Import the library-global entity-cover index from R2 into local `entityCovers`,
 * resolving each to a remote-backed row (display URL + re-export reference, no
 * local bytes — mirrors how remote track covers store `remoteCoverUrl`). LWW per
 * entity: a strictly-newer LOCAL cover is kept; an older local is replaced and its
 * blob cleaned up. (Tombstone/clear propagation is deferred — see the PRD.)
 */
export async function importRemoteEntityCovers(
  input: ImportRemoteEntityCoversInput,
  db: MuzeroDB = defaultDb,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  await db.transaction("rw", db.entityCovers, db.mediaBlobs, async () => {
    for (const entry of input.index.entries) {
      const local = await db.entityCovers.get(entry.id);
      if (!entityCoverRemoteWins(local?.updatedAt, entry.updatedAt)) {
        skipped += 1;
        continue;
      }
      if (local?.coverBlobId) await db.mediaBlobs.delete(local.coverBlobId);
      const row: EntityCover = {
        id: entry.id,
        kind: entry.kind,
        remoteCover: {
          url: resolveRemoteObjectUrl(input.baseUrl, entry.cover.url),
          key: entry.cover.url,
          mime: entry.cover.mime,
          bytes: entry.cover.bytes,
          sha256: entry.cover.sha256,
        },
        crop: entry.crop,
        updatedAt: entry.updatedAt,
      };
      await db.entityCovers.put(row);
      imported += 1;
    }
  });
  return { imported, skipped };
}
