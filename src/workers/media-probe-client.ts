import type { MediabunnyProbeResult } from "@/lib/media-mediabunny-probe";
import { notePerfWork } from "@/lib/perf-counters";

type WorkerResult = MediabunnyProbeResult | null;
type Pending = {
  bytes: number;
  createdWorker: boolean;
  ensureMs: number;
  reject: (error: Error) => void;
  resolve: (result: WorkerResult) => void;
  startedAt: number;
};
type MediaProbeWorkerResponse =
  | { reqId: number; result: WorkerResult; type: "media-probe-result"; workerMs?: number }
  | { error: string; reqId: number; type: "media-probe-error"; workerMs?: number }
  | { reqId: number; type: "media-probe-pong"; workerMs?: number };
type WarmPending = {
  createdWorker: boolean;
  ensureMs: number;
  reject: (error: Error) => void;
  resolve: () => void;
  startedAt: number;
};

let worker: Worker | null = null;
let workerUnavailable = false;
let nextReqId = 1;
const pending = new Map<number, Pending>();
const warmPending = new Map<number, WarmPending>();
let warmPromise: Promise<void> | null = null;
let workerIdleTimer: ReturnType<typeof setTimeout> | undefined;
const MEDIA_PROBE_WORKER_IDLE_MS = 60_000;

export function probeMediaFileViaMediabunnyWorker(file: File): Promise<WorkerResult> {
  const ensureStartedAt = performance.now();
  const { created, worker: w } = getWorker();
  const ensureMs = performance.now() - ensureStartedAt;
  notePerfWork("media.probe.worker.ensure", ensureMs, {
    bytes: file.size,
    created,
    unavailable: !w,
  });
  if (!w) return probeMediaFileViaMediabunnyInline(file);

  const reqId = nextReqId++;
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    pending.set(reqId, {
      bytes: file.size,
      createdWorker: created,
      ensureMs,
      reject,
      resolve,
      startedAt,
    });
    const postStartedAt = performance.now();
    try {
      w.postMessage({ file, reqId, type: "media-probe" });
      notePerfWork("media.probe.worker.postMessage", performance.now() - postStartedAt, {
        bytes: file.size,
        createdWorker: created,
      });
    } catch (error) {
      pending.delete(reqId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function probeMediaFileViaMediabunnyInline(file: File): Promise<WorkerResult> {
  const startedAt = performance.now();
  const { probeMediaFileViaMediabunny } = await import("@/lib/media-mediabunny-probe");
  const result = await probeMediaFileViaMediabunny(file);
  notePerfWork("media.probe.inline", performance.now() - startedAt, {
    bytes: file.size,
    result: Boolean(result),
  });
  return result;
}

function getWorker(): { created: boolean; worker: Worker | null } {
  clearWorkerIdleTimer();
  if (worker) return { created: false, worker };
  if (workerUnavailable || typeof Worker === "undefined") return { created: false, worker: null };
  try {
    worker = new Worker(new URL("./media-probe-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<MediaProbeWorkerResponse>) => {
      const msg = event.data;
      if (msg?.type === "media-probe-result") {
        const item = pending.get(msg.reqId);
        if (item) {
          notePerfWork("media.probe.worker.roundtrip", performance.now() - item.startedAt, {
            bytes: item.bytes,
            createdWorker: item.createdWorker,
            ensureMs: Math.round(item.ensureMs * 10) / 10,
            result: Boolean(msg.result),
            workerMs: msg.workerMs,
          });
          item.resolve(msg.result);
        }
        pending.delete(msg.reqId);
        scheduleWorkerIdleTeardown();
        return;
      }
      if (msg?.type === "media-probe-error") {
        const item = pending.get(msg.reqId);
        if (item) {
          notePerfWork("media.probe.worker.roundtrip", performance.now() - item.startedAt, {
            bytes: item.bytes,
            createdWorker: item.createdWorker,
            ensureMs: Math.round(item.ensureMs * 10) / 10,
            error: true,
            workerMs: msg.workerMs,
          });
          item.reject(new Error(msg.error || "media probe worker failed"));
        }
        pending.delete(msg.reqId);
        scheduleWorkerIdleTeardown();
        return;
      }
      if (msg?.type === "media-probe-pong") {
        const item = warmPending.get(msg.reqId);
        if (item) {
          notePerfWork("media.probe.worker.warm", performance.now() - item.startedAt, {
            createdWorker: item.createdWorker,
            ensureMs: Math.round(item.ensureMs * 10) / 10,
            workerMs: msg.workerMs,
          });
          item.resolve();
        }
        warmPending.delete(msg.reqId);
        scheduleWorkerIdleTeardown();
      }
    };
    worker.onerror = () => {
      workerUnavailable = true;
      for (const item of pending.values()) item.reject(new Error("media probe worker crashed"));
      for (const item of warmPending.values()) item.reject(new Error("media probe worker crashed"));
      pending.clear();
      warmPending.clear();
      worker = null;
      warmPromise = null;
      clearWorkerIdleTimer();
    };
    return { created: true, worker };
  } catch {
    workerUnavailable = true;
    return { created: false, worker: null };
  }
}

export function warmMediaProbeWorker(): Promise<void> {
  if (warmPromise) return warmPromise;
  const ensureStartedAt = performance.now();
  const { created, worker: w } = getWorker();
  const ensureMs = performance.now() - ensureStartedAt;
  notePerfWork("media.probe.worker.ensure", ensureMs, {
    created,
    warm: true,
  });
  if (!w) return Promise.resolve();

  const reqId = nextReqId++;
  warmPromise = new Promise<void>((resolve, reject) => {
    warmPending.set(reqId, {
      createdWorker: created,
      ensureMs,
      reject,
      resolve,
      startedAt: performance.now(),
    });
    try {
      w.postMessage({ reqId, type: "media-probe-ping" });
    } catch (error) {
      warmPending.delete(reqId);
      warmPromise = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  }).catch((error: unknown) => {
    warmPromise = null;
    throw error;
  });
  return warmPromise;
}

function clearWorkerIdleTimer(): void {
  if (!workerIdleTimer) return;
  clearTimeout(workerIdleTimer);
  workerIdleTimer = undefined;
}

function scheduleWorkerIdleTeardown(): void {
  clearWorkerIdleTimer();
  if (!worker || pending.size > 0 || warmPending.size > 0) return;
  workerIdleTimer = setTimeout(() => {
    if (!worker || pending.size > 0 || warmPending.size > 0) return;
    worker.terminate();
    worker = null;
    warmPromise = null;
    workerIdleTimer = undefined;
  }, MEDIA_PROBE_WORKER_IDLE_MS);
}
