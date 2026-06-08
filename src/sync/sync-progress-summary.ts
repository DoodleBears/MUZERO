import type { SyncRun } from "@/db/types";

export type SyncProgressPhase =
  | "preparing"
  | "uploading"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export interface SyncProgressSummary {
  byteRatio: number;
  bytesDone: number;
  currentPhase: SyncProgressPhase;
  error?: string;
  failed: number;
  objectCount: number;
  objectsDone: number;
  totalBytes: number;
}

export function summarizeSyncRunProgress(run: SyncRun): SyncProgressSummary {
  const objectsDone = Math.min(run.objectCount, Math.max(0, run.uploaded + run.skipped));
  return {
    byteRatio: byteRatio(run),
    bytesDone: Math.max(0, run.bytesDone),
    currentPhase: currentPhase(run),
    error: run.error,
    failed: Math.max(0, run.failed),
    objectCount: Math.max(0, run.objectCount),
    objectsDone,
    totalBytes: Math.max(0, run.totalBytes),
  };
}

function currentPhase(run: SyncRun): SyncProgressPhase {
  if (run.status === "completed") return "completed";
  if (run.status === "failed") return "failed";
  if (run.status === "cancelled") return "cancelled";
  return run.direction === "pull" ? "downloading" : run.bytesDone > 0 ? "uploading" : "preparing";
}

function byteRatio(run: SyncRun): number {
  if (run.status === "completed") return 1;
  if (run.totalBytes <= 0) return 0;
  return Math.min(1, Math.max(0, run.bytesDone / run.totalBytes));
}
