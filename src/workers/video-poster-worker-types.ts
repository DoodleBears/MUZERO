import type { VideoFrameScore } from "@/lib/video-frame-score";

export type VideoPosterWorkerRequest = {
  durationSec?: number;
  file: File;
  maxHeight?: number;
  maxWidth?: number;
  reqId: number;
  timeoutMs?: number;
  type: "video-poster";
};

export type VideoPosterWorkerFrame = {
  atTimeSeconds: number;
  bytes: ArrayBuffer;
  height: number;
  mime: string;
  score: VideoFrameScore;
  width: number;
};

export type VideoPosterWorkerResponse =
  | {
      frame: VideoPosterWorkerFrame | null;
      reqId: number;
      type: "video-poster-result";
    }
  | {
      error: string;
      reqId: number;
      type: "video-poster-error";
    };
