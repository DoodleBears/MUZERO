/**
 * Async-job polling engine for cloud music-generation APIs.
 *
 * Most cloud music providers (Suno/Udio-style, Replicate, ElevenLabs Music, …)
 * are asynchronous: you POST a request, get back a job id, then poll a status
 * endpoint until the audio is ready. This is the vendor-agnostic loop; the
 * vendor-specific request/response mapping lives in `cloud-provider.ts`.
 *
 * `now` and `sleep` are injected so the loop is deterministic in tests.
 */

export interface JobStatus {
  state: "pending" | "succeeded" | "failed";
  /** URL to download the rendered audio (when succeeded). */
  audioUrl?: string;
  /** Some vendors return audio bytes inline rather than a URL. */
  blob?: Blob;
  /** 0..1 if the vendor reports it. */
  progress?: number;
  error?: string;
}

export interface PollOptions {
  intervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  /** Injected for tests; default real clock / timer. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class JobTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Music generation timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "JobTimeoutError";
  }
}

export class JobFailedError extends Error {
  constructor(message: string) {
    super(message || "Music generation job failed");
    this.name = "JobFailedError";
  }
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Poll `getStatus` until the job succeeds, fails, or times out. Resolves with
 * the succeeded {@link JobStatus}; throws {@link JobFailedError} /
 * {@link JobTimeoutError} / AbortError otherwise.
 */
export async function pollUntilComplete(
  getStatus: () => Promise<JobStatus>,
  opts: PollOptions,
): Promise<JobStatus> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? realSleep;
  const start = now();

  while (true) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const status = await getStatus();
    if (typeof status.progress === "number") opts.onProgress?.(status.progress);

    if (status.state === "succeeded") return status;
    if (status.state === "failed") throw new JobFailedError(status.error ?? "");

    if (now() - start >= opts.timeoutMs) throw new JobTimeoutError(opts.timeoutMs);
    await sleep(opts.intervalMs);
  }
}
