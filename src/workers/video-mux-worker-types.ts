import type { MuxContainer } from "@/streamsrc/mux/mux-strategy";

/** Main → worker: copy-remux a video-only + audio-only blob into one container. */
export interface VideoMuxWorkerRequest {
  type: "video-mux";
  reqId: number;
  video: Blob;
  audio: Blob;
  container: MuxContainer;
}

/** Worker → main: incremental progress, the finished blob, or an error. */
export type VideoMuxWorkerResponse =
  | { type: "video-mux-progress"; reqId: number; ratio: number }
  | { type: "video-mux-result"; reqId: number; blob: Blob }
  | { type: "video-mux-error"; reqId: number; error: string };
