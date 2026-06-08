import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { DjSession, Memory, SetDisplayMode, Track } from "@/db/types";
import type { RemoteSetIndexResult } from "./r2-subscription";

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
  const trackIds = remoteSet.tracks.map((track) => remoteLocalId("trk", driveId, track.id));
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

  return { sessionId, trackIds };
}
