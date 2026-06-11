import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type {
  CloudDrive,
  CloudDriveAutoSyncFrequency,
  CloudDriveAutoSyncPauseReason,
  CloudDriveUploadConcurrency,
  CloudShare,
} from "@/db/types";

export type CloudDriveInput = Omit<CloudDrive, "createdAt" | "updatedAt"> &
  Partial<Pick<CloudDrive, "createdAt" | "updatedAt">>;

export interface CloudDriveSyncPreferencesInput {
  autoSyncFrequency?: CloudDrive["autoSyncFrequency"];
  uploadConcurrency?: CloudDrive["uploadConcurrency"];
}

export type CloudShareInput = Omit<CloudShare, "addedAt"> & Partial<Pick<CloudShare, "addedAt">>;

export const DEFAULT_CLOUD_DRIVE_AUTO_SYNC_FREQUENCY: CloudDriveAutoSyncFrequency =
  "change-debounce";
export const DEFAULT_CLOUD_DRIVE_UPLOAD_CONCURRENCY: CloudDriveUploadConcurrency = 2;

export async function upsertCloudDrive(
  input: CloudDriveInput,
  db: MuzeroDB = defaultDb,
): Promise<CloudDrive> {
  const now = Date.now();
  const existing = await db.cloudDrives.get(input.id);
  const row: CloudDrive = {
    ...input,
    autoSyncFrequency: normalizeAutoSyncFrequency(
      input.autoSyncFrequency ?? existing?.autoSyncFrequency,
    ),
    uploadConcurrency: normalizeUploadConcurrency(
      input.uploadConcurrency ?? existing?.uploadConcurrency,
    ),
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
  await db.cloudDrives.put(row);
  return row;
}

export function listCloudDrives(db: MuzeroDB = defaultDb): Promise<CloudDrive[]> {
  return db.cloudDrives
    .orderBy("updatedAt")
    .reverse()
    .toArray()
    .then((drives) => drives.map(normalizeCloudDrive));
}

export async function updateCloudDriveSyncPreferences(
  driveId: string,
  input: CloudDriveSyncPreferencesInput,
  db: MuzeroDB = defaultDb,
): Promise<CloudDrive> {
  const existing = await db.cloudDrives.get(driveId);
  if (!existing) throw new Error(`Unknown cloud drive: ${driveId}`);
  const row = normalizeCloudDrive({
    ...existing,
    autoSyncFrequency: normalizeAutoSyncFrequency(
      input.autoSyncFrequency ?? existing.autoSyncFrequency,
    ),
    uploadConcurrency: normalizeUploadConcurrency(
      input.uploadConcurrency ?? existing.uploadConcurrency,
    ),
    autoSyncPausedAt: undefined,
    autoSyncPauseReason: undefined,
    updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
  });
  await db.cloudDrives.put(row);
  return row;
}

export async function pauseCloudDriveAutoSync(
  driveId: string,
  reason: CloudDriveAutoSyncPauseReason,
  db: MuzeroDB = defaultDb,
): Promise<CloudDrive> {
  const existing = await db.cloudDrives.get(driveId);
  if (!existing) throw new Error(`Unknown cloud drive: ${driveId}`);
  const now = Date.now();
  const row = normalizeCloudDrive({
    ...existing,
    autoSyncPausedAt: now,
    autoSyncPauseReason: reason,
    updatedAt: Math.max(now, existing.updatedAt + 1),
  });
  await db.cloudDrives.put(row);
  return row;
}

export async function clearCloudDriveAutoSyncPause(
  driveId: string,
  db: MuzeroDB = defaultDb,
): Promise<CloudDrive> {
  const existing = await db.cloudDrives.get(driveId);
  if (!existing) throw new Error(`Unknown cloud drive: ${driveId}`);
  const row = normalizeCloudDrive({
    ...existing,
    autoSyncPausedAt: undefined,
    autoSyncPauseReason: undefined,
    updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
  });
  await db.cloudDrives.put(row);
  return row;
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

function normalizeCloudDrive(drive: CloudDrive): CloudDrive {
  return {
    ...drive,
    autoSyncFrequency: normalizeAutoSyncFrequency(drive.autoSyncFrequency),
    uploadConcurrency: normalizeUploadConcurrency(drive.uploadConcurrency),
  };
}

function normalizeAutoSyncFrequency(
  value: CloudDrive["autoSyncFrequency"],
): CloudDriveAutoSyncFrequency {
  switch (value) {
    case "app-start":
    case "change-debounce":
    case "15min":
    case "30min":
    case "60min":
      return value;
    default:
      return DEFAULT_CLOUD_DRIVE_AUTO_SYNC_FREQUENCY;
  }
}

function normalizeUploadConcurrency(
  value: CloudDrive["uploadConcurrency"],
): CloudDriveUploadConcurrency {
  return value === 1 || value === 2 || value === 3 ? value : DEFAULT_CLOUD_DRIVE_UPLOAD_CONCURRENCY;
}
