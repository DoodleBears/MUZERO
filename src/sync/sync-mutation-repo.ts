import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { SyncMutation } from "@/db/types";
import { newId } from "@/lib/id";

export type SyncMutationInput = Omit<SyncMutation, "id" | "createdAt"> & {
  id?: string;
  createdAt?: number;
  now?: number;
};

export async function recordSyncMutation(
  input: SyncMutationInput,
  db: MuzeroDB = defaultDb,
): Promise<SyncMutation> {
  const createdAt = input.createdAt ?? input.now ?? Date.now();
  const mutation: SyncMutation = {
    id: input.id ?? newId("mut"),
    driveId: input.driveId,
    devicePublicId: input.devicePublicId,
    scope: input.scope,
    entityId: input.entityId,
    action: input.action,
    base: input.base,
    payload: input.payload,
    createdAt,
    syncedAt: input.syncedAt,
  };
  await db.syncMutations.put(mutation);
  return mutation;
}

export async function listUnsyncedMutations(
  driveId: string,
  db: MuzeroDB = defaultDb,
): Promise<SyncMutation[]> {
  const rows = await db.syncMutations.where("driveId").equals(driveId).toArray();
  return rows
    .filter((mutation) => mutation.syncedAt == null)
    .sort((a, b) => a.createdAt - b.createdAt);
}
