/**
 * Build a {@link DownloadPlan} from a resolved video track + audio track — pure. Decides
 * the mux strategy (copy vs opt-in transcode) via {@link chooseMuxStrategy}. The actual
 * provider resolution (calling `resolveVideo` / `resolve`) and the byte fetch + mux happen
 * in the Phase-2 orchestrator; this layer is the deterministic, unit-tested core.
 */

import {
  type AudioCodec,
  type ChooseMuxOptions,
  chooseMuxStrategy,
  classifyAudioCodec,
  type MuxStrategy,
} from "./mux/mux-strategy";
import type { PlayableStream, PlayableVideoTrack } from "./provider";

export interface DownloadPlan {
  video: PlayableVideoTrack;
  audio: PlayableStream;
  strategy: MuxStrategy;
}

export interface BuildDownloadPlanOptions extends ChooseMuxOptions {
  /** Override the audio codec classification (else inferred from `audio.mime`). */
  audioCodec?: AudioCodec;
}

/** Pair a video + audio track into a download plan with a chosen mux strategy. */
export function buildDownloadPlan(
  video: PlayableVideoTrack,
  audio: PlayableStream,
  opts: BuildDownloadPlanOptions = {},
): DownloadPlan {
  const audioCodec = opts.audioCodec ?? classifyAudioCodec(audio.mime);
  const strategy = chooseMuxStrategy(video.codec, audioCodec, opts);
  return { video, audio, strategy };
}
