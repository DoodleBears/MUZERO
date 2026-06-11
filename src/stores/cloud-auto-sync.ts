import { getSettings } from "@/db/repositories";
import { log } from "@/lib/logger";
import {
  type CloudAutoSyncScheduler,
  createCloudAutoSyncScheduler,
} from "@/sync/auto-sync-scheduler";
import { findPendingCloudDriveLocalChangesSince } from "@/sync/cloud-drive-dirty";
import { listCloudDrives } from "@/sync/cloud-drive-repo";
import { getR2CredentialsForDrive } from "@/sync/cloud-drive-settings";
import { useSyncStore } from "./sync-store";

const RUNNING_SYNC_PHASES = new Set(["planning", "uploading", "downloading", "applying"]);
const AUTO_SYNC_TICK_MS = 60_000;
const AUTO_SYNC_JITTER_MAX_MS = 30_000;

let scheduler: CloudAutoSyncScheduler | null = null;
const jitterByDrive = new Map<string, number>();

export function startCloudAutoSyncScheduler(): () => void {
  if (scheduler) return () => scheduler?.stop();
  scheduler = createCloudAutoSyncScheduler({
    intervalMs: AUTO_SYNC_TICK_MS,
    getDrives: listCloudDrives,
    hasCredentials: async (drive) =>
      Boolean(getR2CredentialsForDrive(await getSettings(), drive.id)),
    isDriveRunning: (driveId) => {
      const phase = useSyncStore.getState().progressByDrive[driveId]?.phase;
      return phase ? RUNNING_SYNC_PHASES.has(phase) : false;
    },
    isVisible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
    isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
    now: () => Date.now(),
    jitterMs: stableJitterMs,
    pendingLocalChangesSince: findPendingCloudDriveLocalChangesSince,
    publishDrive: (driveId) => useSyncStore.getState().publishDrive(driveId),
    onError: (error) => log.warn("sync", "cloud auto-sync scheduler tick failed", { error }),
  });
  scheduler.start();
  return () => {
    scheduler?.stop();
    scheduler = null;
  };
}

function stableJitterMs(driveId: string): number {
  const existing = jitterByDrive.get(driveId);
  if (existing != null) return existing;
  const next = Math.floor(Math.random() * AUTO_SYNC_JITTER_MAX_MS);
  jitterByDrive.set(driveId, next);
  return next;
}
