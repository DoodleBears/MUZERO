/**
 * Download-queue decisions — PURE (no IO, no Date.now). The runner ({@link
 * ./download-queue-runner}) owns the timers + persistence (download-job-repo) and calls
 * these to decide what to start, what to recover after a restart, and how to retry.
 * Exhaustively unit-tested. Mirrors the "pure decision + injectable scheduler" split of
 * `sync/auto-sync-scheduler`.
 */

import type { DownloadJob } from "@/db/types";

export const MAX_DOWNLOAD_ATTEMPTS = 4;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 10 * 60_000;

export interface EnqueueInput {
  source: DownloadJob["source"];
  externalId: string;
  title: string;
  quality?: string;
  audioOnly?: boolean;
  sessionId?: string;
  coverUrl?: string;
}

/** A fresh pending job. `id`/`now` injected so this stays pure (testable). */
export function createDownloadJob(input: EnqueueInput, id: string, now: number): DownloadJob {
  return {
    id,
    source: input.source,
    externalId: input.externalId,
    title: input.title,
    quality: input.quality,
    audioOnly: input.audioOnly,
    sessionId: input.sessionId,
    coverUrl: input.coverUrl,
    status: "pending",
    bytesDone: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Dedupe key: two jobs download the same thing iff source+externalId+quality+audioOnly match. */
export function sameTarget(a: DownloadJob, b: DownloadJob): boolean {
  return (
    a.source === b.source &&
    a.externalId === b.externalId &&
    (a.quality ?? "") === (b.quality ?? "") &&
    Boolean(a.audioOnly) === Boolean(b.audioOnly)
  );
}

/** Pending jobs to start now: up to (concurrency − active), oldest first. */
export function selectNextJobs(jobs: DownloadJob[], concurrency: number): DownloadJob[] {
  const active = jobs.filter((j) => j.status === "active").length;
  const slots = Math.max(0, concurrency - active);
  if (slots === 0) return [];
  return jobs
    .filter((j) => j.status === "pending")
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, slots);
}

/** Jobs left "active" from a previous run — the runner resets these to pending on start. */
export function jobsToRecover(jobs: DownloadJob[]): DownloadJob[] {
  return jobs.filter((j) => j.status === "active");
}

/** Whether a failed job still has retries left. */
export function canRetry(job: DownloadJob, maxAttempts = MAX_DOWNLOAD_ATTEMPTS): boolean {
  return job.attempts < maxAttempts;
}

/** Exponential backoff (ms) for the Nth attempt — capped. */
export function retryBackoffMs(attempts: number): number {
  const exp = RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(exp, RETRY_MAX_MS);
}
