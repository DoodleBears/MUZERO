import { create } from "zustand";
import { getSettings, listSessions } from "@/db/repositories";
import { log } from "@/lib/logger";
import { listCloudDrives } from "@/sync/cloud-drive-repo";
import { getR2CredentialsForDrive } from "@/sync/cloud-drive-settings";
import { buildR2ExportPlanForDrive } from "@/sync/r2-export-plan";
import { runR2PublishSync } from "@/sync/r2-publish-sync";
import {
  type ApplyRemoteSetPullInput,
  applyRemoteSetPull,
  dryRunRemoteSetPull,
} from "@/sync/r2-pull-sync";
import {
  createSyncOrchestrator,
  type PublishDriveContext,
  type SyncOrchestrator,
  type SyncProgress,
} from "@/sync/sync-orchestrator";

/**
 * The small Zustand store PRD §5.6 calls for: it owns ONLY ephemeral per-drive
 * sync progress and cancellation. It resolves the publish context from IndexedDB
 * and delegates the actual planning/uploading to the pure `SyncOrchestrator`.
 * Durable run history stays in the `syncRuns` table; localized copy lives in the
 * UI — this layer holds no i18n strings, only state.
 */
interface SyncStoreState {
  /** Latest ephemeral progress per drive id (push or pull). */
  progressByDrive: Record<string, SyncProgress>;
  /** Plan + publish all local-origin sets to a writable owned/trusted drive. */
  publishDrive: (driveId: string) => Promise<void>;
  /** Dry-run + apply a remote set pull (caller supplies the resolved remote set). */
  pullRemoteSet: (input: ApplyRemoteSetPullInput) => Promise<void>;
  /** Abort an in-flight publish/pull for a drive (cancel between objects). */
  cancel: (driveId: string) => void;
}

// Non-reactive singletons (never selected by components → no rerenders).
const controllers = new Map<string, AbortController>();
let orchestratorOverride: SyncOrchestrator | null = null;

/** Test seam: inject a fake orchestrator. Pass `null` to restore the real one. */
export function __setSyncOrchestratorForTest(orchestrator: SyncOrchestrator | null): void {
  orchestratorOverride = orchestrator;
}

function getOrchestrator(): SyncOrchestrator {
  if (orchestratorOverride) return orchestratorOverride;
  return createSyncOrchestrator({
    buildPlan: buildR2ExportPlanForDrive,
    runPublish: runR2PublishSync,
    dryRunPull: dryRunRemoteSetPull,
    applyPull: applyRemoteSetPull,
  });
}

/** Remote-imported sets keep their `ses_remote_` prefix and are not re-published. */
function isLocalOriginSet(sessionId: string): boolean {
  return !sessionId.startsWith("ses_remote_");
}

/** Resolve everything the orchestrator needs to publish a drive, or throw why not. */
async function resolvePublishContext(driveId: string): Promise<PublishDriveContext> {
  const settings = await getSettings();
  const drives = await listCloudDrives();
  const drive = drives.find((candidate) => candidate.id === driveId);
  if (!drive) throw new Error(`Unknown cloud drive: ${driveId}`);
  if (!drive.capabilities.write) throw new Error("This drive is read-only");
  const baseUrl = drive.publicBaseUrl;
  if (!baseUrl) throw new Error("This drive has no public base URL");
  const credentials = getR2CredentialsForDrive(settings, driveId);
  if (!credentials) throw new Error("No R2 credentials are configured for this drive");

  const sessions = await listSessions();
  const setIds = sessions.map((session) => session.id).filter(isLocalOriginSet);

  return {
    drive,
    settings,
    credentials,
    libraryId: drive.id,
    baseUrl,
    setIds,
    // Manual sync flushes a small pending stats segment (PRD §5).
    planInput: { playbackEventFlush: { mode: "manual", now: Date.now() } },
  };
}

function failedProgress(driveId: string, error: string): SyncProgress {
  return {
    driveId,
    direction: "push",
    phase: "failed",
    objectsDone: 0,
    objectsTotal: 0,
    bytesDone: 0,
    bytesTotal: 0,
    error,
  };
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  progressByDrive: {},

  async publishDrive(driveId) {
    let context: PublishDriveContext;
    try {
      context = await resolvePublishContext(driveId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProgress(set, driveId, failedProgress(driveId, message));
      log.warn("sync", "publish blocked before start", { driveId, message });
      return;
    }

    const controller = new AbortController();
    controllers.set(driveId, controller);
    try {
      await getOrchestrator().publish(context, {
        signal: controller.signal,
        onProgress: (progress) => setProgress(set, driveId, progress),
      });
    } catch (error) {
      // The orchestrator already emitted a `failed` progress before throwing.
      log.error("sync", "publish failed", { driveId, error });
    } finally {
      controllers.delete(driveId);
    }
  },

  async pullRemoteSet(input) {
    const { driveId } = input;
    const controller = new AbortController();
    controllers.set(driveId, controller);
    try {
      await getOrchestrator().pull(input, {
        signal: controller.signal,
        onProgress: (progress) => setProgress(set, driveId, progress),
      });
    } catch (error) {
      log.error("sync", "pull failed", { driveId, error });
    } finally {
      controllers.delete(driveId);
    }
  },

  cancel(driveId) {
    controllers.get(driveId)?.abort();
  },
}));

function setProgress(
  set: (partial: (state: SyncStoreState) => Partial<SyncStoreState>) => void,
  driveId: string,
  progress: SyncProgress,
): void {
  set((state) => ({ progressByDrive: { ...state.progressByDrive, [driveId]: progress } }));
}
