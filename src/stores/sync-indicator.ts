/**
 * App-wide sync indicator. Bridges the two background sync sources — local-folder
 * import ({@link useFolderImportStore}) and R2 cloud publish/pull
 * ({@link useSyncStore}) — onto the notification store as ONE persistent,
 * cancelable toast per operation. Pure glue: it reuses `notify.loading` (persistent)
 * + an in-place `notify.update` for live progress, swapping to a terminal toast on
 * completion. Started once from `App.tsx`.
 */

import { getSettings } from "@/db/repositories";
import i18n from "@/i18n/i18n";
import { createDiagnosticLogger } from "@/lib/logger";
import { listCloudDrives } from "@/sync/cloud-drive-repo";
import type { SyncPhase, SyncProgress } from "@/sync/sync-orchestrator";
import { type FolderImportProgress, useFolderImportStore } from "./folder-import-store";
import { type NotificationAction, notify } from "./notification-store";
import { useSyncStore } from "./sync-store";

/** Active loading-toast id per operation key (`folder-import` / `r2:<driveId>`). */
const toastIds = new Map<string, string>();
const syncIndicatorLog = createDiagnosticLogger("sync.indicator");

const cancelAction = (onClick: () => void): NotificationAction => ({
  label: i18n.t("drop.cancel"),
  onClick,
  keepOpen: true,
});

function skipDetail(encrypted: number, decodeFailed: number): string | undefined {
  const parts: string[] = [];
  if (encrypted > 0) parts.push(i18n.t("folderImport.skippedEncrypted", { count: encrypted }));
  if (decodeFailed > 0) parts.push(i18n.t("drop.skipped", { count: decodeFailed }));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function roundSyncIndicatorMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function traceImportToast(
  event: string,
  progress: FolderImportProgress | null,
  startedAt: number,
  extra: Record<string, unknown> = {},
): void {
  syncIndicatorLog.debug(event, {
    traceId: progress?.traceId,
    category: "sync",
    phase: "state",
    durationMs: roundSyncIndicatorMs(performance.now() - startedAt),
    folderPhase: progress?.phase ?? "clear",
    done: progress?.done,
    total: progress?.total,
    imported: progress?.imported,
    coverDone: progress?.coverDone,
    coverTotal: progress?.coverTotal,
    ...extra,
  });
}

// --- local-folder import -------------------------------------------------------

function reconcileImport(progress: FolderImportProgress | null): void {
  const key = "folder-import";
  const id = toastIds.get(key);

  if (!progress || progress.phase === "scanning") {
    // Stay silent during scan; only a cleared progress dismisses a stray toast.
    if (!progress && id) {
      const startedAt = performance.now();
      notify.dismiss(id);
      toastIds.delete(key);
      traceImportToast("folder-import.toast.dismiss", progress, startedAt, { hadToast: true });
    } else if (progress?.phase === "scanning") {
      traceImportToast("folder-import.toast.scan-silent", progress, performance.now(), {
        hadToast: Boolean(id),
      });
    }
    return;
  }

  if (progress.phase === "importing" || progress.phase === "covers") {
    if (progress.total === 0) return; // nothing fresh — keep boot syncs quiet
    // Same loading toast across both stages: importing the audio, then filling in
    // the covers (which keep downloading after the files are already playable).
    const message =
      progress.phase === "covers"
        ? i18n.t("folderImport.fetchingCovers")
        : i18n.t("sessions.importing");
    const detail =
      progress.phase === "covers"
        ? i18n.t("folderImport.coversProgress", {
            done: progress.coverDone ?? 0,
            total: progress.coverTotal ?? 0,
          })
        : i18n.t("folderImport.importingProgress", {
            done: progress.done,
            total: progress.total,
          });
    if (id) {
      const startedAt = performance.now();
      notify.update(id, { message, detail });
      traceImportToast("folder-import.toast.update", progress, startedAt, {
        hadToast: true,
        toastId: id,
      });
    } else {
      const startedAt = performance.now();
      toastIds.set(
        key,
        notify.loading(message, {
          detail,
          actions: [cancelAction(() => useFolderImportStore.getState().cancel())],
        }),
      );
      traceImportToast("folder-import.toast.create", progress, startedAt, {
        hadToast: false,
        toastId: toastIds.get(key),
      });
    }
    return;
  }

  // Terminal: completed | cancelled. Swap the loading toast for a fresh terminal
  // one so the (now-stale) Cancel action is gone.
  const hadToast = Boolean(id);
  if (id) {
    const dismissStartedAt = performance.now();
    notify.dismiss(id);
    toastIds.delete(key);
    traceImportToast("folder-import.toast.dismiss", progress, dismissStartedAt, {
      hadToast: true,
      toastId: id,
    });
  }
  const detail = skipDetail(progress.encrypted, progress.decodeFailed);

  if (progress.phase === "cancelled") {
    if (hadToast) {
      const startedAt = performance.now();
      notify.info(i18n.t("folderImport.cancelled", { count: progress.imported }), { detail });
      traceImportToast("folder-import.toast.terminal", progress, startedAt, {
        kind: "cancelled",
        hadToast,
      });
    }
    return;
  }
  // completed
  if (progress.imported > 0) {
    const startedAt = performance.now();
    notify.success(i18n.t("folderImport.imported", { count: progress.imported }), {
      detail,
      actions: [
        { label: i18n.t("folderImport.publishNow"), onClick: () => void publishDefaultDrive() },
      ],
    });
    traceImportToast("folder-import.toast.terminal", progress, startedAt, {
      kind: "success",
      hadToast,
    });
  } else if (detail) {
    const startedAt = performance.now();
    notify.warning(detail);
    traceImportToast("folder-import.toast.terminal", progress, startedAt, {
      kind: "warning",
      hadToast,
    });
  }
}

/** Opt-in "Upload to cloud" from the import-success toast: publish to the default
 *  writable drive, or nudge the user to set one up. */
async function publishDefaultDrive(): Promise<void> {
  const [settings, drives] = await Promise.all([getSettings(), listCloudDrives()]);
  const drive =
    drives.find((d) => d.id === settings.defaultCloudDriveId && d.kind === "owned") ??
    drives.find((d) => d.kind === "owned");
  if (!drive) {
    notify.info(i18n.t("folderImport.noCloudDrive"));
    return;
  }
  await useSyncStore.getState().publishDrive(drive.id);
}

// --- R2 cloud sync -------------------------------------------------------------

const RUNNING_PHASES = new Set<SyncPhase>(["planning", "uploading", "downloading", "applying"]);
const PHASE_LABEL_KEY = {
  planning: "settings.cloudSyncPhasePreparing",
  uploading: "settings.cloudSyncPhaseUploading",
  downloading: "settings.cloudSyncPhaseDownloading",
  applying: "settings.cloudSyncPhaseApplying",
  completed: "settings.cloudSyncPhaseCompleted",
  failed: "settings.cloudSyncPhaseFailed",
  cancelled: "settings.cloudSyncPhaseCancelled",
  "needs-review": "settings.cloudSyncPhaseNeedsReview",
} as const satisfies Record<SyncPhase, string>;

function reconcileR2(driveId: string, p: SyncProgress): void {
  const key = `r2:${driveId}`;
  const id = toastIds.get(key);

  if (RUNNING_PHASES.has(p.phase)) {
    const message = i18n.t("settings.cloudSyncProgressTitle");
    const detail = `${i18n.t(PHASE_LABEL_KEY[p.phase])} · ${i18n.t("settings.cloudSyncObjects", {
      done: p.objectsDone,
      total: p.objectsTotal,
    })}`;
    if (id) {
      notify.update(id, { message, detail });
    } else {
      toastIds.set(
        key,
        notify.loading(message, {
          detail,
          actions: [cancelAction(() => useSyncStore.getState().cancel(driveId))],
        }),
      );
    }
    return;
  }

  // Terminal.
  if (id) {
    notify.dismiss(id);
    toastIds.delete(key);
  }
  const label = i18n.t(PHASE_LABEL_KEY[p.phase]);
  if (p.phase === "completed") {
    // A completed pull without a runId is the dry-run "unchanged" path. Page
    // refreshes can trigger many of these; close any transient loading toast but
    // do not spam one success notification per already-synced set.
    if (p.runId) notify.success(label);
  } else if (p.phase === "failed") notify.error(label, { detail: p.error });
  else if (p.phase === "cancelled") notify.info(label);
  else if (p.phase === "needs-review") notify.warning(label);
}

// --- wiring --------------------------------------------------------------------

let started = false;

/** Subscribe both sync sources to the notification store. Idempotent (StrictMode-safe). */
export function startSyncIndicator(): void {
  if (started) return;
  started = true;

  useFolderImportStore.subscribe((state, prev) => {
    if (state.progress !== prev.progress) reconcileImport(state.progress);
  });

  useSyncStore.subscribe((state, prev) => {
    for (const [driveId, progress] of Object.entries(state.progressByDrive)) {
      if (progress !== prev.progressByDrive[driveId]) reconcileR2(driveId, progress);
    }
  });
}
