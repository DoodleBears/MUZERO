import { create } from "zustand";
import { getSettings, listSessions } from "@/db/repositories";
import { log } from "@/lib/logger";
import {
  clearCloudDriveAutoSyncPause,
  listCloudDrives,
  pauseCloudDriveAutoSync,
} from "@/sync/cloud-drive-repo";
import { getR2CredentialsForDrive } from "@/sync/cloud-drive-settings";
import { buildR2ExportPlanForDrive } from "@/sync/r2-export-plan";
import { publishedEntityId } from "@/sync/r2-import-stream";
import { fetchRemotePublishBase } from "@/sync/r2-publish-base";
import { runR2PublishSync } from "@/sync/r2-publish-sync";
import {
  type ApplyRemoteSetPullInput,
  applyRemoteSetPull,
  dryRunRemoteSetPull,
} from "@/sync/r2-pull-sync";
import { applySetPullMerges } from "@/sync/r2-set-pull-merge";
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
    // Multi-writer read-merge-write (PRD §12.4): every publish plans against
    // the current remote state and merges instead of mirroring over it.
    fetchPublishBase: fetchRemotePublishBase,
    // Same-set co-editing receive half (PRD §12.5).
    applyPullMerges: applySetPullMerges,
    dryRunPull: dryRunRemoteSetPull,
    applyPull: applyRemoteSetPull,
  });
}

/**
 * Which sets publish to THIS drive: every local-origin set, plus sets imported
 * FROM this drive (they write back under their original ids — co-editing, PRD
 * §12.5). Sets imported from OTHER drives never cross drives.
 */
function publishesToDrive(sessionId: string, driveId: string): boolean {
  if (!sessionId.startsWith("ses_remote_")) return true;
  return publishedEntityId("ses", driveId, sessionId) !== sessionId;
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
  const setIds = sessions
    .map((session) => session.id)
    .filter((id) => publishesToDrive(id, driveId));

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
    // One operation per drive at a time (audit F8): a concurrent publish/pull
    // would overwrite this drive's AbortController and interleave its progress.
    // Register the controller BEFORE the async context resolve so a rapid second
    // call can't slip through the gap.
    if (controllers.has(driveId)) {
      log.warn("sync", "publish refused: another sync is in flight for this drive", { driveId });
      return;
    }
    const controller = new AbortController();
    controllers.set(driveId, controller);
    try {
      let context: PublishDriveContext;
      try {
        context = await resolvePublishContext(driveId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProgress(set, driveId, failedProgress(driveId, message));
        log.warn("sync", "publish blocked before start", { driveId, message });
        return;
      }

      const result = await getOrchestrator().publish(context, {
        signal: controller.signal,
        onProgress: (progress) => setProgress(set, driveId, progress),
      });
      if (result.status === "completed") {
        await clearCloudDriveAutoSyncPause(driveId);
      } else if (result.status === "needs-review") {
        await pauseCloudDriveAutoSync(driveId, "needs-review");
      } else if (result.status === "cancelled") {
        await pauseCloudDriveAutoSync(driveId, "cancelled");
      }
    } catch (error) {
      // The orchestrator already emitted a `failed` progress before throwing.
      await pauseCloudDriveAutoSync(driveId, "failed").catch(() => undefined);
      log.error("sync", "publish failed", { driveId, error });
    } finally {
      controllers.delete(driveId);
    }
  },

  async pullRemoteSet(input) {
    const { driveId } = input;
    if (controllers.has(driveId)) {
      log.warn("sync", "pull refused: another sync is in flight for this drive", { driveId });
      return;
    }
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
