import {
  type ExtractedVideoPosterFrame,
  extractUsefulVideoPosterFrame,
  type VideoPosterFrameOptions,
} from "@/lib/video-poster-frame";
import type { VideoPosterWorkerResponse } from "./video-poster-worker-types";

type Pending = {
  reject: (error: Error) => void;
  resolve: (frame: ExtractedVideoPosterFrame | null) => void;
};

let worker: Worker | null = null;
let workerUnavailable = false;
let nextReqId = 1;
const pending = new Map<number, Pending>();

export async function extractUsefulVideoPosterFrameViaWorker(
  file: File,
  options: VideoPosterFrameOptions = {},
): Promise<ExtractedVideoPosterFrame | null> {
  throwIfAborted(options.signal);
  const w = getWorker();
  if (!w) return extractUsefulVideoPosterFrame(file, options);

  const reqId = nextReqId++;
  try {
    return await new Promise<ExtractedVideoPosterFrame | null>((resolve, reject) => {
      const onAbort = () => {
        pending.delete(reqId);
        reject(abortError());
      };
      pending.set(reqId, {
        reject: (error) => {
          options.signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        resolve: (frame) => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve(frame);
        },
      });
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      w.postMessage({
        durationSec: options.durationSec,
        file,
        maxHeight: options.maxHeight,
        maxWidth: options.maxWidth,
        reqId,
        timeoutMs: options.timeoutMs,
        type: "video-poster",
      });
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return extractUsefulVideoPosterFrame(file, options);
  }
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./video-poster-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<VideoPosterWorkerResponse>) => {
      const msg = event.data;
      if (msg?.type === "video-poster-result") {
        const item = pending.get(msg.reqId);
        if (!item) return;
        pending.delete(msg.reqId);
        item.resolve(
          msg.frame
            ? {
                atTimeSeconds: msg.frame.atTimeSeconds,
                blob: new Blob([msg.frame.bytes], { type: msg.frame.mime }),
                height: msg.frame.height,
                mime: msg.frame.mime,
                score: msg.frame.score,
                source: "mediabunny",
                width: msg.frame.width,
              }
            : null,
        );
        return;
      }
      if (msg?.type === "video-poster-error") {
        const item = pending.get(msg.reqId);
        if (!item) return;
        pending.delete(msg.reqId);
        item.reject(new Error(msg.error || "video poster worker failed"));
      }
    };
    worker.onerror = () => {
      workerUnavailable = true;
      for (const item of pending.values()) item.reject(new Error("video poster worker crashed"));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("Video poster extraction aborted.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
