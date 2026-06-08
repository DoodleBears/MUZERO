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
    return { ...base, action: "unchanged" };
  }

  const mutations = await localMutationsForSet(input.driveId, remoteSetId, db);
  const conflicting = mutations.filter((mutation) =>
    mutationChangedFromRemoteBase(mutation, input),
  );
  if (conflicting.length > 0) {
    return {
      ...base,
      action: "conflict",
      reasons: ["local-and-remote-changed"],
      conflict: {
        entityType: "set",
        entityId: remoteSetId,
        reason: "local-and-remote-changed",
        localMutationIds: conflicting.map((mutation) => mutation.id),
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

async function localMutationsForSet(
  driveId: string,
  remoteSetId: string,
  db: MuzeroDB,
): Promise<SyncMutation[]> {
  const rows = await listUnsyncedMutations(driveId, db);
  return rows.filter((mutation) => mutation.scope === "set" && mutation.entityId === remoteSetId);
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
