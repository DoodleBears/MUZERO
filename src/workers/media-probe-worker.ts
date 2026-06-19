/// <reference lib="webworker" />

import { probeMediaFileViaMediabunny } from "@/lib/media-mediabunny-probe";

type MediaProbeWorkerRequest =
  | {
      file: File;
      reqId: number;
      type: "media-probe";
    }
  | {
      reqId: number;
      type: "media-probe-ping";
    };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<MediaProbeWorkerRequest>) => {
  const msg = event.data;
  if (msg?.type === "media-probe-ping") {
    const startedAt = performance.now();
    ctx.postMessage({
      reqId: msg.reqId,
      type: "media-probe-pong",
      workerMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
    return;
  }
  if (msg?.type !== "media-probe") return;
  const startedAt = performance.now();
  try {
    const result = await probeMediaFileViaMediabunny(msg.file);
    ctx.postMessage({
      reqId: msg.reqId,
      result,
      type: "media-probe-result",
      workerMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  } catch (error) {
    ctx.postMessage({
      error: error instanceof Error ? error.message : String(error),
      reqId: msg.reqId,
      type: "media-probe-error",
      workerMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  }
};
