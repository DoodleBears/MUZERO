// Main-thread client for the video-mux worker. Mirrors video-poster-client: lazily spawns
// one module worker, routes responses by reqId, and falls back to a direct main-thread mux
// when Workers are unavailable or the worker crashes.

import { muxCopyTracks } from "@/streamsrc/mux/mux-mediabunny";
import type { MuxContainer } from "@/streamsrc/mux/mux-strategy";
import type { VideoMuxWorkerResponse } from "./video-mux-worker-types";

interface Pending {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
  onProgress?: (ratio: number) => void;
}

let worker: Worker | null = null;
let workerUnavailable = false;
let nextReqId = 1;
const pending = new Map<number, Pending>();

/** Copy-remux off the main thread; falls back to a direct call if the worker can't run. */
export async function muxCopyTracksViaWorker(
  video: Blob,
  audio: Blob,
  container: MuxContainer,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const w = getWorker();
  if (!w) return muxCopyTracks(video, audio, container, onProgress);

  const reqId = nextReqId++;
  try {
    return await new Promise<Blob>((resolve, reject) => {
      pending.set(reqId, { resolve, reject, onProgress });
      w.postMessage({ type: "video-mux", reqId, video, audio, container });
    });
  } catch {
    // Worker errored mid-job — retry once on the main thread so the download still lands.
    return muxCopyTracks(video, audio, container, onProgress);
  }
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./video-mux-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<VideoMuxWorkerResponse>) => {
      const msg = event.data;
      const item = msg ? pending.get(msg.reqId) : undefined;
      if (!item) return;
      if (msg.type === "video-mux-progress") {
        item.onProgress?.(msg.ratio);
        return;
      }
      pending.delete(msg.reqId);
      if (msg.type === "video-mux-result") item.resolve(msg.blob);
      else if (msg.type === "video-mux-error")
        item.reject(new Error(msg.error || "mux worker failed"));
    };
    worker.onerror = () => {
      workerUnavailable = true;
      for (const item of pending.values()) item.reject(new Error("mux worker crashed"));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}
