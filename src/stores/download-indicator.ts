/**
 * Download-queue indicator. Bridges the persistent download queue
 * ({@link DownloadJob} rows in `downloadJobs`) onto the notification store as ONE
 * persistent, in-place loading toast — mirroring {@link sync-indicator} for R2 /
 * folder-import. Replaces the old top-right floating badge: all background progress
 * (download / playback / sync / import) now lives in the left notification stack,
 * with the toast's `progress` bar showing aggregate byte completion.
 *
 * The aggregation ({@link summarizeDownloadJobs}) and reconcile lifecycle
 * ({@link createDownloadReconciler}) are pure + injectable so they unit-test without
 * Dexie; `startDownloadIndicator` wires the real liveQuery + notify + nav.
 */

import { liveQuery, type Subscription } from "dexie";
import { db } from "@/db/muzero-db";
import type { DownloadJob } from "@/db/types";
import i18n from "@/i18n/i18n";
import { log } from "@/lib/logger";
import { useNavStore } from "@/stores/nav-store";
import { type NotificationAction, notify } from "@/stores/notification-store";

/** Active + pending jobs aggregated into the single download toast. */
export interface DownloadSummary {
  /** In-flight (active + pending) job count. */
  count: number;
  /** 0..1 average byte progress over active jobs that report `totalBytes`, else null. */
  progress: number | null;
}

const IN_FLIGHT: ReadonlyArray<DownloadJob["status"]> = ["active", "pending"];

/**
 * Reduce the queue to a count + aggregate byte progress. Only `active` jobs with a
 * known `totalBytes` count toward progress (Bilibili reports bytes; YouTube uses blob
 * transport with no total → count-only, same口径 as the old badge). null = no bar.
 */
export function summarizeDownloadJobs(jobs: readonly DownloadJob[]): DownloadSummary {
  const inFlight = jobs.filter((j) => IN_FLIGHT.includes(j.status));
  const withBytes = inFlight.filter((j) => j.status === "active" && (j.totalBytes ?? 0) > 0);
  const progress = withBytes.length
    ? withBytes.reduce((sum, j) => sum + j.bytesDone / (j.totalBytes ?? 1), 0) / withBytes.length
    : null;
  return { count: inFlight.length, progress };
}

/** Minimal slice of the notification store the reconciler needs (injectable for tests). */
export interface DownloadIndicatorView {
  loading: (
    message: string,
    opts?: { detail?: string; progress?: number; actions?: NotificationAction[] },
  ) => string;
  update: (id: string, patch: { message?: string; detail?: string; progress?: number }) => void;
  dismiss: (id: string) => void;
}

export interface DownloadReconcilerDeps {
  view: DownloadIndicatorView;
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** Tap-through target (jump to Settings → Downloads), replacing the badge's onClick. */
  onView: () => void;
}

/**
 * Stateful reconciler: maps each queue snapshot to a single persistent loading toast —
 * create on the first in-flight tick, `update` in place after, `dismiss` when it drains.
 * Returns a `(jobs) => void` to feed from the liveQuery (or a test).
 */
export function createDownloadReconciler(
  deps: DownloadReconcilerDeps,
): (jobs: readonly DownloadJob[]) => void {
  let toastId: string | null = null;
  return (jobs) => {
    const { count, progress } = summarizeDownloadJobs(jobs);
    if (count === 0) {
      if (toastId) {
        deps.view.dismiss(toastId);
        toastId = null;
      }
      return;
    }
    const message = deps.t("download.inProgress", { count });
    const detail = progress != null ? `${Math.round(progress * 100)}%` : undefined;
    const barProgress = progress ?? undefined;
    if (toastId) {
      deps.view.update(toastId, { message, detail, progress: barProgress });
    } else {
      toastId = deps.view.loading(message, {
        detail,
        progress: barProgress,
        actions: [{ label: deps.t("download.view"), onClick: deps.onView, keepOpen: true }],
      });
    }
  };
}

let subscription: Subscription | null = null;

/** Subscribe the download queue to the notification stack. Idempotent (StrictMode-safe). */
export function startDownloadIndicator(): void {
  if (subscription) return;
  const reconcile = createDownloadReconciler({
    view: notify,
    t: (key, opts) => i18n.t(key as never, opts as never) as unknown as string,
    onView: () => useNavStore.getState().setTab("settings"),
  });
  subscription = liveQuery(() =>
    db.downloadJobs.where("status").anyOf("active", "pending").toArray(),
  ).subscribe({
    next: reconcile,
    error: (err) => log.warn("download", "download indicator liveQuery failed", err),
  });
}
