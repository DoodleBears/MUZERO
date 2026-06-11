import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { SyncMutation } from "@/db/types";
import type { RemoteSetIndexResult } from "./r2-subscription";
import { listUnsyncedMutations } from "./sync-mutation-repo";

export type RemoteSetDiffAction =
  | "create-set"
  | "unchanged"
  | "apply-remote"
  | "keep-local"
  | "conflict"
  | "blocked";

export interface RemoteSetConflict {
  entityType: "set" | "track" | "memory";
  entityId: string;
  reason: "local-and-remote-changed";
  localMutationIds: string[];
}

export interface RemoteSetDiff {
  action: RemoteSetDiffAction;
  remoteSetId: string;
  localSessionId?: string;
  reasons: string[];
  conflict?: RemoteSetConflict;
  reason?: "hash-mismatch";
}

export interface DiffRemoteSetInput {
  driveId: string;
  remoteSet: RemoteSetIndexResult;
  remoteIndexSha256?: string;
}

export async function diffRemoteSet(
  input: DiffRemoteSetInput,
  db: MuzeroDB = defaultDb,
): Promise<RemoteSetDiff> {
  const remoteSetId = input.remoteSet.index.set.id;
  const localSessionId = remoteLocalId("ses", input.driveId, remoteSetId);
  const base: Omit<RemoteSetDiff, "action"> = {
    remoteSetId,
    localSessionId,
    reasons: [],
  };

  const local = await db.sessions.get(localSessionId);
  if (!local) return { ...base, action: "create-set", reasons: ["missing-local-set"] };

  const knownIndex = await db.syncObjects.get(
    syncObjectId(input.driveId, setIndexKey(remoteSetId)),
  );
  if (
    input.remoteIndexSha256 &&
    knownIndex?.sha256 &&
    input.remoteIndexSha256 !== knownIndex.sha256
  ) {
    return {
      ...base,
      action: "blocked",
      reason: "hash-mismatch",
      reasons: ["remote-index-hash-changed"],
    };
  }

  const remoteUpdatedAt = input.remoteSet.index.set.updatedAt;
  if (local.updatedAt === remoteUpdatedAt && sameTrackShape(local.trackIds, input)) {
    if (await sameTrackRows(input, db)) return { ...base, action: "unchanged" };
    return { ...base, action: "apply-remote", reasons: ["remote-track-metadata-missing"] };
  }

  const mutations = await localMutationsForSet(input.driveId, remoteSetId, db);
  const conflicting = mutations
    .map((mutation) => ({
      mutation,
      entity: mutationConflictEntity(mutation, input),
    }))
    .filter(
      (entry): entry is { mutation: SyncMutation; entity: ConflictEntity } =>
        entry.entity != null && mutationChangedFromRemoteBase(entry.mutation, input),
    );
  if (conflicting.length > 0) {
    const firstConflict = conflicting[0];
    return {
      ...base,
      action: "conflict",
      reasons: ["local-and-remote-changed"],
      conflict: {
        entityType: firstConflict.entity.type,
        entityId: firstConflict.entity.id,
        reason: "local-and-remote-changed",
        localMutationIds: conflicting.map((entry) => entry.mutation.id),
      },
    };
  }

  if (remoteUpdatedAt > local.updatedAt) {
    return { ...base, action: "apply-remote", reasons: ["remote-updated"] };
  }

  return { ...base, action: "keep-local", reasons: ["local-newer"] };
}

function mutationChangedFromRemoteBase(mutation: SyncMutation, input: DiffRemoteSetInput): boolean {
  const baseUpdatedAt = mutation.base?.updatedAt ?? 0;
  return input.remoteSet.index.set.updatedAt > baseUpdatedAt;
}

interface ConflictEntity {
  type: RemoteSetConflict["entityType"];
  id: string;
}

function mutationConflictEntity(
  mutation: SyncMutation,
  input: DiffRemoteSetInput,
): ConflictEntity | undefined {
  if (mutation.scope === "set") {
    return matchesRemoteSetId(mutation.entityId, input)
      ? { type: "set", id: input.remoteSet.index.set.id }
      : undefined;
  }

  if (mutation.scope === "track") {
    const remoteTrack = input.remoteSet.index.tracks.find((track) =>
      matchesRemoteEntityId("trk", input.driveId, mutation.entityId, track.id),
    );
    if (remoteTrack) return { type: "track", id: remoteTrack.id };
  }

  if (mutation.scope === "memory") {
    for (const track of input.remoteSet.index.tracks) {
      const remoteMemory = track.memories.find((memory) =>
        matchesRemoteEntityId("mem", input.driveId, mutation.entityId, memory.id),
      );
      if (remoteMemory) return { type: "memory", id: remoteMemory.id };
    }
  }

  if (
    (mutation.scope === "track" || mutation.scope === "memory") &&
    mutation.base?.remoteKey === setIndexKey(input.remoteSet.index.set.id)
  ) {
    return { type: mutation.scope === "memory" ? "memory" : "track", id: mutation.entityId };
  }

  return undefined;
}

function matchesRemoteSetId(entityId: string, input: DiffRemoteSetInput): boolean {
  return (
    entityId === input.remoteSet.index.set.id ||
    entityId === remoteLocalId("ses", input.driveId, input.remoteSet.index.set.id)
  );
}

function matchesRemoteEntityId(
  prefix: "trk" | "mem",
  driveId: string,
  entityId: string,
  remoteId: string,
): boolean {
  return entityId === remoteId || entityId === remoteLocalId(prefix, driveId, remoteId);
}

async function localMutationsForSet(
  driveId: string,
  remoteSetId: string,
  db: MuzeroDB,
): Promise<SyncMutation[]> {
  const rows = await listUnsyncedMutations(driveId, db);
  const remoteIndexKey = setIndexKey(remoteSetId);
  return rows.filter(
    (mutation) =>
      (mutation.scope === "set" || mutation.scope === "track" || mutation.scope === "memory") &&
      (mutation.base?.remoteKey === remoteIndexKey ||
        (mutation.scope === "set" && mutation.entityId === remoteSetId)),
  );
}

function sameTrackShape(localTrackIds: string[], input: DiffRemoteSetInput): boolean {
  const remoteTrackIds = input.remoteSet.tracks.map((track) =>
    remoteLocalId("trk", input.driveId, track.id),
  );
  return (
    localTrackIds.length === remoteTrackIds.length &&
    localTrackIds.every((trackId, index) => trackId === remoteTrackIds[index])
  );
}

async function sameTrackRows(input: DiffRemoteSetInput, db: MuzeroDB): Promise<boolean> {
  for (const remoteTrack of input.remoteSet.tracks) {
    const localId = remoteLocalId("trk", input.driveId, remoteTrack.id);
    const local = await db.tracks.get(localId);
    if (!local) return false;
    if (local.title !== remoteTrack.source.title) return false;
    if (local.kind !== remoteTrack.source.kind) return false;
    if (local.origin !== remoteTrack.source.origin) return false;
    if (local.provider !== remoteTrack.source.provider) return false;
    if ((local.providerPreset ?? undefined) !== (remoteTrack.source.providerPreset ?? undefined)) {
      return false;
    }
    if (local.durationSec !== remoteTrack.source.durationSec) return false;
    if (local.remoteMediaUrl !== remoteTrack.mediaUrl) return false;
    if ((local.remoteCoverUrl ?? undefined) !== (remoteTrack.coverUrl ?? undefined)) return false;
    if ((local.brief ?? undefined) !== (remoteTrack.source.brief ?? undefined)) return false;
    if (!sameJson(local.mediaMetadata, remoteTrack.source.mediaMetadata)) return false;
  }
  return true;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function setIndexKey(remoteSetId: string): string {
  return `sets/${remoteSetId}/index.json`;
}

function syncObjectId(driveId: string, key: string): string {
  return `${driveId}:${key}`;
}

function remoteLocalId(prefix: "ses" | "trk" | "mem", driveId: string, remoteId: string): string {
  return `${prefix}_remote_${safeIdPart(driveId)}_${safeIdPart(remoteId)}`;
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}
