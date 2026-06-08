import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { CloudDrive, CloudShare } from "@/db/types";

export type CloudDriveInput = Omit<CloudDrive, "createdAt" | "updatedAt"> &
  Partial<Pick<CloudDrive, "createdAt" | "updatedAt">>;

export type CloudShareInput = Omit<CloudShare, "addedAt"> & Partial<Pick<CloudShare, "addedAt">>;

export async function upsertCloudDrive(
  input: CloudDriveInput,
  db: MuzeroDB = defaultDb,
): Promise<CloudDrive> {
  const now = Date.now();
  const existing = await db.cloudDrives.get(input.id);
  const row: CloudDrive = {
    ...input,
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
  await db.cloudDrives.put(row);
  return row;
}

export function listCloudDrives(db: MuzeroDB = defaultDb): Promise<CloudDrive[]> {
  return db.cloudDrives.orderBy("updatedAt").reverse().toArray();
}

export async function upsertCloudShare(
  input: CloudShareInput,
  db: MuzeroDB = defaultDb,
): Promise<CloudShare> {
  const existing = await db.cloudShares.get(input.id);
  const row: CloudShare = {
    ...input,
    addedAt: input.addedAt ?? existing?.addedAt ?? Date.now(),
  };
  await db.cloudShares.put(row);
  return row;
}

export function listCloudShares(db: MuzeroDB = defaultDb): Promise<CloudShare[]> {
  return db.cloudShares
    .toArray()
    .then((shares) =>
      shares.sort((a, b) => (b.lastSyncedAt ?? b.addedAt) - (a.lastSyncedAt ?? a.addedAt)),
    );
}
