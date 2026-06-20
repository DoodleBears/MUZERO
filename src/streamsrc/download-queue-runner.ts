/**
 * Download-queue runner — drives the persistent queue: honors a concurrency cap, recovers
 * jobs left mid-flight after a restart, and retries failures with backoff. All IO is
 * injected (list/put/update jobs, runJob, timers) so it's deterministically unit-testable;
 * the production singleton wires the `download-job-repo` + a real `runJob`. The decisions
 * themselves live in the pure {@link ./download-queue}.
 */

import type { DownloadJob } from "@/db/types";
import {
  canRetry,
  createDownloadJob,
  type EnqueueInput,
  retryBackoffMs,
  sameTarget,
} from "./download-queue";

/** Result of running one job to completion. */
export interface RunJobResult {
  ok: boolean;
  trackId?: string;
  /** Worth retrying (network/expired-url) vs terminal (login/permission). */
  retriable: boolean;
  error?: string;
}

export interface DownloadQueueDeps {
  now: () => number;
  newId: () => string;
  /** Max concurrent downloads (reads AppSettings.downloadConcurrency). */
  getConcurrency: () => number;
  listJobs: () => Promise<DownloadJob[]>;
  putJob: (job: DownloadJob) => Promise<void>;
  updateJob: (id: string, patch: Partial<DownloadJob>) => Promise<void>;
  /** Run a job to completion, reporting byte progress. */
  runJob: (
    job: DownloadJob,
    onProgress: (bytesDone: number, totalBytes?: number) => void,
  ) => Promise<RunJobResult>;
  /** Schedule a retry after `delayMs` (injectable so tests control time). */
  scheduleRetry: (delayMs: number, cb: () => void) => void;
  onChange?: () => void;
}

export interface DownloadQueueRunner {
  enqueue: (input: EnqueueInput) => Promise<DownloadJob>;
  recover: () => Promise<void>;
  tick: () => Promise<void>;
  isRunning: (id: string) => boolean;
}

export function createDownloadQueueRunner(deps: DownloadQueueDeps): DownloadQueueRunner {
  // Jobs this runner has started (authoritative concurrency count — avoids races with the
  // async DB status write between selecting and marking a job active).
  const running = new Set<string>();
  let ticking = false;

  async function enqueue(input: EnqueueInput): Promise<DownloadJob> {
    const jobs = await deps.listJobs();
    const candidate = createDownloadJob(input, deps.newId(), deps.now());
    const existing = jobs.find(
      (j) => j.status !== "done" && j.status !== "failed" && sameTarget(j, candidate),
    );
    if (existing) return existing; // dedupe: already queued/active/paused
    await deps.putJob(candidate);
    deps.onChange?.();
    void tick();
    return candidate;
  }

  async function recover(): Promise<void> {
    const jobs = await deps.listJobs();
    for (const j of jobs) {
      if (j.status === "active") await deps.updateJob(j.id, { status: "pending" });
    }
    deps.onChange?.();
    void tick();
  }

  async function tick(): Promise<void> {
    if (ticking) return; // single-flight; startJob calls tick() again when a slot frees
    ticking = true;
    try {
      while (deps.getConcurrency() - running.size > 0) {
        const jobs = await deps.listJobs();
        const next = jobs
          .filter((j) => j.status === "pending" && !running.has(j.id))
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!next) break;
        running.add(next.id);
        await deps.updateJob(next.id, { status: "active" });
        deps.onChange?.();
        void startJob(next);
      }
    } finally {
      ticking = false;
    }
  }

  async function startJob(job: DownloadJob): Promise<void> {
    try {
      const result = await deps.runJob(job, (bytesDone, totalBytes) => {
        void deps.updateJob(job.id, { bytesDone, totalBytes });
      });
      if (result.ok) {
        await deps.updateJob(job.id, {
          status: "done",
          trackId: result.trackId,
          partStorageKey: undefined,
        });
      } else if (result.retriable) {
        await failAndMaybeRetry(job, result.error);
      } else {
        await deps.updateJob(job.id, { status: "failed", lastError: result.error });
      }
    } catch (err) {
      await failAndMaybeRetry(job, err instanceof Error ? err.message : String(err));
    } finally {
      running.delete(job.id);
      deps.onChange?.();
      void tick();
    }
  }

  async function failAndMaybeRetry(job: DownloadJob, error?: string): Promise<void> {
    const attempts = job.attempts + 1;
    await deps.updateJob(job.id, { status: "failed", attempts, lastError: error });
    if (canRetry({ ...job, attempts })) {
      deps.scheduleRetry(retryBackoffMs(attempts), () => {
        void deps.updateJob(job.id, { status: "pending" }).then(() => tick());
      });
    }
  }

  return { enqueue, recover, tick, isRunning: (id) => running.has(id) };
}
