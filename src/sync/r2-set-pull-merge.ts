import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { DjSession, Memory, Track } from "@/db/types";
import { RANK_SPACING } from "@/player/set-order";
import type { R2SetIndex } from "./r2-manifest-schema";
import type { RemotePublishBase } from "./r2-publish-base";
import { resolveRemoteObjectUrl } from "./r2-url";

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function remoteLocalId(prefix: "ses" | "trk" | "mem", driveId: string, remoteId: string): string {
  return `${prefix}_remote_${safeIdPart(driveId)}_${safeIdPart(remoteId)}`;
}

function publishedSetIdOf(driveId: string, localId: string): string {
  const prefix = `ses_remote_${safeIdPart(driveId)}_`;
  return localId.startsWith(prefix) ? localId.slice(prefix.length) : localId;
}

export interface ApplySetPullMergesInput {
  driveId: string;
  baseUrl: string;
  /** Local session ids participating in this sync. */
  setIds: string[];
  base: RemotePublishBase;
  db?: MuzeroDB;
}

/**
 * The receive half of same-set co-editing (PRD §12.5), run between the base
 * fetch and the publish plan: apply each remote set index INTO its matching
 * local session — other devices' new members land as remote-backed rows (with
 * their memories), remote removal tombstones drop membership, and set metadata
 * is LWW. `session.lastPulledAt` disambiguates a genuine re-add (local member,
 * re-added AFTER the tombstone was already applied by an earlier pull) from a
 * stale copy that never saw the removal.
 */
export async function applySetPullMerges(
  input: ApplySetPullMergesInput,
): Promise<{ merged: number }> {
  const db = input.db ?? defaultDb;
  let merged = 0;
  for (const localId of input.setIds) {
    const publishedId = publishedSetIdOf(input.driveId, localId);
    const remote = input.base.setIndexes?.[publishedId]?.value;
    if (!remote) continue;
    if (await mergeRemoteIntoSession(localId, remote, input, db)) merged += 1;
  }
  return { merged };
}

async function mergeRemoteIntoSession(
  localSessionId: string,
  remote: R2SetIndex,
  input: ApplySetPullMergesInput,
  db: MuzeroDB,
): Promise<boolean> {
  const session = await db.sessions.get(localSessionId);
  if (!session) return false;
  const lastPulledAt = session.lastPulledAt ?? 0;
  const memberIds = new Set(session.trackIds);
  const localIdsFor = (remoteTrackId: string) => [
    remoteTrackId,
    remoteLocalId("trk", input.driveId, remoteTrackId),
  ];

  let changed = false;
  const ranks = { ...session.trackRanks };
  let trackIds = [...session.trackIds];

  // 1. Remote removal tombstones drop membership — unless this session re-added
  //    the member after a previous pull already applied the removal.
  for (const tombstone of remote.removedTracks ?? []) {
    for (const candidate of localIdsFor(tombstone.id)) {
      if (!memberIds.has(candidate)) continue;
      if (lastPulledAt > tombstone.removedAt) continue; // genuine local re-add
      trackIds = trackIds.filter((id) => id !== candidate);
      memberIds.delete(candidate);
      delete ranks[candidate];
      changed = true;
    }
  }

  // 2. Other devices' members join as remote-backed rows (+ their memories).
  const newTracks: Track[] = [];
  const newMemories: Memory[] = [];
  for (const entry of remote.tracks) {
    const candidates = localIdsFor(entry.id);
    if (candidates.some((id) => memberIds.has(id))) continue;
    // A locally-tombstoned member stays out until our publish revokes/settles it.
    if (candidates.some((id) => session.removedTracks?.[id] != null)) continue;
    const existing = await db.tracks.get(entry.id);
    const rowId = existing ? entry.id : remoteLocalId("trk", input.driveId, entry.id);
    if (!existing && !(await db.tracks.get(rowId))) {
      newTracks.push({
        id: rowId,
        sessionId: localSessionId,
        title: entry.title,
        kind: entry.kind,
        origin: entry.origin,
        brief: entry.brief ?? undefined,
        provider: entry.provider,
        providerPreset: entry.providerPreset ?? undefined,
        streamSourceId: entry.streamSourceId,
        streamExternalId: entry.streamExternalId,
        streamMeta: entry.streamMeta,
        status: "ready",
        durationSec: entry.durationSec,
        remoteMediaUrl: entry.media
          ? resolveRemoteObjectUrl(input.baseUrl, entry.media.url)
          : undefined,
        remoteCoverUrl: entry.cover
          ? resolveRemoteObjectUrl(input.baseUrl, entry.cover.url)
          : undefined,
        coverCrop: entry.coverCrop,
        coverThumbhash: entry.thumbhash ?? undefined,
        createdAt: entry.createdAt,
        updatedAt: entry.createdAt,
        generatedAt: entry.generatedAt ?? undefined,
        playCount: 0,
        liked: entry.liked,
        tags: entry.tags,
        mediaMetadata: entry.mediaMetadata,
      });
      newMemories.push(
        ...entry.memories.map((memory) => ({
          id: remoteLocalId("mem", input.driveId, memory.id),
          trackId: rowId,
          note: memory.note,
          author: memory.author,
          remotePhotoUrl: memory.photo
            ? resolveRemoteObjectUrl(input.baseUrl, memory.photo.url)
            : undefined,
          createdAt: memory.createdAt,
          atSec: memory.atSec,
        })),
      );
    }
    trackIds = [...trackIds, rowId];
    memberIds.add(rowId);
    if (typeof entry.rank === "number") ranks[rowId] = entry.rank;
    else if (Object.keys(ranks).length > 0) {
      ranks[rowId] = Math.max(...Object.values(ranks)) + RANK_SPACING;
    }
    changed = true;
  }

  // 3. Set metadata is last-write-wins.
  const next: DjSession = { ...session, trackIds, lastPulledAt: Date.now() };
  if (Object.keys(ranks).length > 0) next.trackRanks = ranks;
  if (remote.set.updatedAt > session.updatedAt) {
    next.name = remote.set.name;
    next.seedPrompt = remote.set.seedPrompt;
    next.displayMode = remote.set.displayMode === "title" ? "cover" : remote.set.displayMode;
    next.config = remote.set.config;
    if (!next.coverBlobId) {
      next.remoteCoverUrl = remote.set.cover
        ? resolveRemoteObjectUrl(input.baseUrl, remote.set.cover.url)
        : undefined;
      next.coverCrop = remote.set.coverCrop;
      next.coverThumbhash = remote.set.thumbhash;
    }
    next.updatedAt = remote.set.updatedAt;
    changed = true;
  }

  await db.transaction("rw", db.sessions, db.tracks, db.memories, async () => {
    await db.sessions.put(next);
    if (newTracks.length > 0) await db.tracks.bulkPut(newTracks);
    if (newMemories.length > 0) await db.memories.bulkPut(newMemories);
  });
  return changed;
}
