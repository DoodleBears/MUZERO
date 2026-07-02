/**
 * Download-center view math — PURE (no IO, no Date.now, no store/DB imports). Projects a
 * {@link DownloadJob} queue snapshot into the "downloads" Gallery tab's filter slices,
 * display order, and aggregate counts/progress. Exhaustively unit-tested (hard rule #7).
 *
 * This module is the canonical owner of the aggregate byte-progress formula; the download
 * indicator ({@link ../stores/download-indicator}) delegates to {@link downloadAggregateProgress}
 * so the tab's progress bar and the notification toast never disagree (same口径).
 */

import type { DownloadJob, DownloadJobStatus } from "@/db/types";

/** Filter chip on the downloads tab. `active` = user-facing "进行中" = not yet finished. */
export type DownloadFilter = "all" | "active" | "done" | "failed";

/** Statuses that count as in-flight / "进行中" (the job is not in a terminal state). */
const IN_FLIGHT_STATUSES: readonly DownloadJobStatus[] = ["active", "pending", "paused"];

/** Whether a job is still in-flight (active, queued, or paused) rather than done/failed. */
export function isInFlight(status: DownloadJobStatus): boolean {
  return IN_FLIGHT_STATUSES.includes(status);
}

/** Slice the queue by the active filter chip. Never mutates the input. */
export function filterDownloadJobs(
  jobs: readonly DownloadJob[],
  filter: DownloadFilter,
): DownloadJob[] {
  switch (filter) {
    case "all":
      return [...jobs];
    case "active":
      return jobs.filter((j) => isInFlight(j.status));
    case "done":
      return jobs.filter((j) => j.status === "done");
    case "failed":
      return jobs.filter((j) => j.status === "failed");
  }
}

/** Display rank: active work first, terminal states last. */
const STATUS_RANK: Record<DownloadJobStatus, number> = {
  active: 0,
  pending: 1,
  paused: 2,
  failed: 3,
  done: 4,
};

/**
 * Stable display order: active → pending → paused → failed → done; within a status group,
 * most-recently-updated first. Never mutates the input (returns a fresh array).
 */
export function orderDownloadJobs(jobs: readonly DownloadJob[]): DownloadJob[] {
  return [...jobs].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    return b.updatedAt - a.updatedAt;
  });
}

/**
 * Average byte completion (0..1) over active jobs that report a `totalBytes`, else null.
 * The single source of truth for aggregate download progress — the notification indicator
 * ({@link ../stores/download-indicator}#summarizeDownloadJobs) delegates here. `null` means
 * "no measurable progress" (e.g. YouTube blob transport has no Content-Length) → no bar.
 */
export function downloadAggregateProgress(jobs: readonly DownloadJob[]): number | null {
  const withBytes = jobs.filter((j) => j.status === "active" && (j.totalBytes ?? 0) > 0);
  if (withBytes.length === 0) return null;
  return (
    withBytes.reduce((sum, j) => sum + j.bytesDone / (j.totalBytes ?? 1), 0) / withBytes.length
  );
}

/** Per-bucket counts + aggregate progress for the tab's summary header. */
export interface DownloadCenterSummary {
  total: number;
  /** active + pending + paused. */
  inFlight: number;
  done: number;
  failed: number;
  /** 0..1, or null when no active job reports measurable bytes (same口径 as the toast). */
  progress: number | null;
}

/** Reduce the queue snapshot to header counts + aggregate progress. Pure. */
export function summarizeDownloadCenter(jobs: readonly DownloadJob[]): DownloadCenterSummary {
  let inFlight = 0;
  let done = 0;
  let failed = 0;
  for (const j of jobs) {
    if (isInFlight(j.status)) inFlight++;
    else if (j.status === "done") done++;
    else if (j.status === "failed") failed++;
  }
  return {
    total: jobs.length,
    inFlight,
    done,
    failed,
    progress: downloadAggregateProgress(jobs),
  };
}
