import type { CloudDrive, CloudDriveAutoSyncFrequency } from "@/db/types";

export const AUTO_SYNC_APP_START_DELAY_MS = 30_000;
export const AUTO_SYNC_CHANGE_DEBOUNCE_MS = 120_000;
export const AUTO_SYNC_MIN_CHANGE_INTERVAL_MS = 300_000;
export const AUTO_SYNC_FAILURE_BACKOFF_BASE_MS = 15 * 60_000;
export const AUTO_SYNC_FAILURE_BACKOFF_MAX_MS = 6 * 60 * 60_000;

export interface AutoSyncDecisionInput {
  drive: CloudDrive;
  hasCredentials: boolean;
  isRunning: boolean;
  isVisible: boolean;
  isOnline: boolean;
  now: number;
  appStartedAt: number;
  jitterMs: number;
  lastAutoSyncStartedAt?: number;
  pendingLocalChangesSince?: number;
  consecutiveFailures?: number;
}

export interface CloudAutoSyncSchedulerDeps {
  appStartedAt?: number;
  intervalMs?: number;
  getDrives: () => Promise<CloudDrive[]>;
  hasCredentials: (drive: CloudDrive) => Promise<boolean> | boolean;
  isDriveRunning: (driveId: string) => boolean;
  isVisible: () => boolean;
  isOnline: () => boolean;
  now: () => number;
  jitterMs: (driveId: string) => number;
  pendingLocalChangesSince?: (driveId: string) => Promise<number | undefined> | number | undefined;
  publishDrive: (driveId: string) => Promise<void>;
  setTimer?: (handler: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
  onError?: (error: unknown) => void;
}

export interface CloudAutoSyncScheduler {
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

const INTERVAL_MS_BY_FREQUENCY = {
  "15min": 15 * 60_000,
  "30min": 30 * 60_000,
  "60min": 60 * 60_000,
} as const satisfies Partial<Record<CloudDriveAutoSyncFrequency, number>>;

export function shouldRunAutoSync(input: AutoSyncDecisionInput): boolean {
  const frequency = input.drive.autoSyncFrequency ?? "manual";
  if (frequency === "manual") return false;
  if (!input.drive.capabilities.write || !input.hasCredentials) return false;
  if (input.isRunning || !input.isVisible || !input.isOnline) return false;
  if (input.drive.autoSyncPausedAt != null) return false;
  if (isInFailureBackoff(input)) return false;

  if (frequency === "app-start") {
    if (input.lastAutoSyncStartedAt != null) return false;
    return input.now >= input.appStartedAt + AUTO_SYNC_APP_START_DELAY_MS + input.jitterMs;
  }

  if (frequency === "change-debounce") {
    if (input.pendingLocalChangesSince == null) return false;
    if (input.now < input.pendingLocalChangesSince + AUTO_SYNC_CHANGE_DEBOUNCE_MS) return false;
    if (input.lastAutoSyncStartedAt == null) return true;
    return (
      input.now >= input.lastAutoSyncStartedAt + AUTO_SYNC_MIN_CHANGE_INTERVAL_MS + input.jitterMs
    );
  }

  const interval = INTERVAL_MS_BY_FREQUENCY[frequency];
  if (!interval) return false;
  const last = input.lastAutoSyncStartedAt ?? input.appStartedAt;
  return input.now >= last + interval + input.jitterMs;
}

export function createCloudAutoSyncScheduler(
  deps: CloudAutoSyncSchedulerDeps,
): CloudAutoSyncScheduler {
  const appStartedAt = deps.appStartedAt ?? deps.now();
  const intervalMs = deps.intervalMs ?? 60_000;
  const lastAutoSyncStartedAt = new Map<string, number>();
  const consecutiveFailures = new Map<string, number>();
  let timer: number | undefined;

  const tick = async (): Promise<void> => {
    const drives = await deps.getDrives();
    const now = deps.now();
    for (const drive of drives) {
      const pendingLocalChangesSince = await deps.pendingLocalChangesSince?.(drive.id);
      const due = shouldRunAutoSync({
        drive,
        hasCredentials: await deps.hasCredentials(drive),
        isRunning: deps.isDriveRunning(drive.id),
        isVisible: deps.isVisible(),
        isOnline: deps.isOnline(),
        now,
        appStartedAt,
        jitterMs: deps.jitterMs(drive.id),
        lastAutoSyncStartedAt: lastAutoSyncStartedAt.get(drive.id),
        pendingLocalChangesSince,
        consecutiveFailures: consecutiveFailures.get(drive.id),
      });
      if (!due) continue;
      lastAutoSyncStartedAt.set(drive.id, now);
      try {
        await deps.publishDrive(drive.id);
        consecutiveFailures.delete(drive.id);
      } catch {
        const current = consecutiveFailures.get(drive.id) ?? 0;
        consecutiveFailures.set(drive.id, current + 1);
      }
    }
  };

  return {
    tick,
    start() {
      if (timer != null) return;
      const run = () => void tick().catch((error) => deps.onError?.(error));
      timer = deps.setTimer?.(run, intervalMs) ?? window.setInterval(run, intervalMs);
      run();
    },
    stop() {
      if (timer == null) return;
      const clearTimer = deps.clearTimer ?? window.clearInterval;
      clearTimer(timer);
      timer = undefined;
    },
  };
}

function isInFailureBackoff(input: AutoSyncDecisionInput): boolean {
  const failures = input.consecutiveFailures ?? 0;
  if (failures <= 0 || input.lastAutoSyncStartedAt == null) return false;
  const backoff = Math.min(
    AUTO_SYNC_FAILURE_BACKOFF_BASE_MS * 2 ** failures,
    AUTO_SYNC_FAILURE_BACKOFF_MAX_MS,
  );
  return input.now < input.lastAutoSyncStartedAt + backoff;
}
