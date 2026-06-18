/// <reference lib="webworker" />

import { extractVideoFramesBatchViaMediabunny } from "@/lib/media-mediabunny-frames";
import { candidatePosterTimes, selectBestScoredFrame } from "@/lib/video-frame-score";
import type {
  VideoPosterWorkerRequest,
  VideoPosterWorkerResponse,
} from "./video-poster-worker-types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<VideoPosterWorkerRequest>) => {
  const msg = event.data;
  if (msg?.type !== "video-poster") return;

  try {
    const frames = await extractVideoFramesBatchViaMediabunny(
      msg.file,
      candidatePosterTimes(msg.durationSec),
      {
        durationSec: msg.durationSec,
        maxHeight: msg.maxHeight,
        maxWidth: msg.maxWidth,
        timeoutMs: msg.timeoutMs,
      },
    );
    const best = frames ? selectBestScoredFrame(frames) : null;
    if (!best) {
      post({ frame: null, reqId: msg.reqId, type: "video-poster-result" });
      return;
    }

    const bytes = await best.blob.arrayBuffer();
    post(
      {
        frame: {
          atTimeSeconds: best.atTimeSeconds,
          bytes,
          height: best.height,
          mime: best.mime,
          score: best.score,
          width: best.width,
        },
        reqId: msg.reqId,
        type: "video-poster-result",
      },
      [bytes],
    );
  } catch (error) {
    post({
      error: error instanceof Error ? error.message : String(error),
      reqId: msg.reqId,
      type: "video-poster-error",
    });
  }
};

function post(message: VideoPosterWorkerResponse, transfers: Transferable[] = []): void {
  ctx.postMessage(message, transfers);
}
