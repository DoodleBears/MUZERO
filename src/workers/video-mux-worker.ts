/// <reference lib="webworker" />
// Off-main-thread copy-remux (rule 7): a large download's merge step would otherwise
// jank the UI for a second or two. mediabunny's packet-copy path needs no DOM/WebCodecs
// encoder, so it runs cleanly in a module worker; Blobs cross the boundary by structured
// clone. The client falls back to a direct call if the worker is unavailable.

import { muxCopyTracks } from "@/streamsrc/mux/mux-mediabunny";
import type { VideoMuxWorkerRequest, VideoMuxWorkerResponse } from "./video-mux-worker-types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(message: VideoMuxWorkerResponse) {
  ctx.postMessage(message);
}

ctx.onmessage = async (event: MessageEvent<VideoMuxWorkerRequest>) => {
  const msg = event.data;
  if (msg?.type !== "video-mux") return;
  const { reqId } = msg;
  try {
    const blob = await muxCopyTracks(msg.video, msg.audio, msg.container, (ratio) =>
      post({ type: "video-mux-progress", reqId, ratio }),
    );
    post({ type: "video-mux-result", reqId, blob });
  } catch (err) {
    post({
      type: "video-mux-error",
      reqId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
