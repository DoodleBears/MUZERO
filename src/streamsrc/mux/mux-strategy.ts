/**
 * Pure mux-strategy decision — given a resolved video codec + audio codec, decide how
 * to combine the two DASH tracks into one file. The guiding rule (video-download PRD
 * §4.2): **default always copies** (transmux, no re-encode) into a Chromium-playable
 * container by pairing the audio to the video's container family; transcoding is opt-in
 * (user forces a single mp4) and never bundles FFmpeg — it runs via Chromium WebCodecs
 * or a user-provided system ffmpeg.
 *
 * Container × codec facts (Mediabunny can mux all of these; Chromium can only *play* a
 * subset reliably — that playability is what this picker targets):
 *   mp4  ← video avc/hevc/av1 + audio aac/flac/ac3/mp3   (Chromium plays)
 *   webm ← video vp9/av1(/vp8) + audio opus/vorbis        (Chromium plays)
 *   mkv  ← anything (lossless archive; NOT reliably playable in Chromium → save-only)
 */

import type { VideoCodec } from "../provider";

export type AudioCodec = "aac" | "opus" | "flac" | "ac3" | "mp3" | "vorbis" | "other";
export type MuxContainer = "mp4" | "webm" | "mkv";

/** Runtime encode capabilities probed at call time (never bundles FFmpeg). */
export interface MuxCaps {
  /** WebCodecs can ENCODE H.264/AVC in this runtime. */
  webcodecsAvc?: boolean;
  /** WebCodecs can ENCODE AAC in this runtime. */
  webcodecsAac?: boolean;
  /** A user-provided system ffmpeg is available (BYO, not shipped). */
  systemFfmpeg?: boolean;
}

export type MuxStrategy =
  | { kind: "copy"; container: MuxContainer }
  | { kind: "transcode"; via: "webcodecs" | "system-ffmpeg"; container: "mp4" }
  | { kind: "unsupported"; reason: string };

export interface ChooseMuxOptions {
  /** User asked for a single mp4 (max portability). The only trigger for transcode. */
  forceContainer?: "mp4";
  caps?: MuxCaps;
}

const MP4_VIDEO_COPY = new Set<VideoCodec>(["avc", "hevc", "av1"]);
const WEBM_VIDEO_COPY = new Set<VideoCodec>(["vp9", "av1"]);
const MP4_AUDIO_COPY = new Set<AudioCodec>(["aac", "flac", "ac3", "mp3"]);
const WEBM_AUDIO_COPY = new Set<AudioCodec>(["opus", "vorbis"]);

/** Classify an audio track's codec from its mime, refined by a `codecs` string if given. */
export function classifyAudioCodec(mime?: string, codecs?: string): AudioCodec {
  const c = (codecs ?? "").toLowerCase();
  if (c) {
    if (c.includes("flac")) return "flac";
    if (c.includes("ec-3") || c.includes("ac-3") || c.startsWith("ac3") || c.startsWith("eac3"))
      return "ac3";
    if (c.includes("mp4a")) return "aac";
    if (c.includes("opus")) return "opus";
    if (c.includes("vorbis")) return "vorbis";
    if (c.includes("mp3") || c === "mp4a.69" || c === "mp4a.6b") return "mp3";
  }
  const m = (mime ?? "").split(";")[0].trim().toLowerCase();
  switch (m) {
    case "audio/mp4":
    case "audio/aac":
      return "aac";
    case "audio/webm":
      return "opus";
    case "audio/ogg":
      return "vorbis";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/flac":
      return "flac";
    default:
      return "other";
  }
}

function mp4Playable(v: VideoCodec, a: AudioCodec): boolean {
  return MP4_VIDEO_COPY.has(v) && MP4_AUDIO_COPY.has(a);
}

function webmPlayable(v: VideoCodec, a: AudioCodec): boolean {
  return WEBM_VIDEO_COPY.has(v) && WEBM_AUDIO_COPY.has(a);
}

/**
 * Decide the mux strategy. Default (no `forceContainer`) always returns a `copy`: the
 * Chromium-playable container if one fits, else `mkv` (lossless archive). With
 * `forceContainer: "mp4"`, copy when already mp4-playable, else transcode via whatever
 * capability is present, else `unsupported`.
 */
export function chooseMuxStrategy(
  video: VideoCodec,
  audio: AudioCodec,
  opts: ChooseMuxOptions = {},
): MuxStrategy {
  const caps = opts.caps ?? {};

  if (opts.forceContainer === "mp4") {
    if (mp4Playable(video, audio)) return { kind: "copy", container: "mp4" };
    const needVideoEncode = !MP4_VIDEO_COPY.has(video); // e.g. vp9 → must re-encode to avc
    const needAudioEncode = !MP4_AUDIO_COPY.has(audio); // e.g. opus → must re-encode to aac
    if (caps.systemFfmpeg) return { kind: "transcode", via: "system-ffmpeg", container: "mp4" };
    const webcodecsCovers =
      (!needVideoEncode || caps.webcodecsAvc === true) &&
      (!needAudioEncode || caps.webcodecsAac === true);
    if (webcodecsCovers) return { kind: "transcode", via: "webcodecs", container: "mp4" };
    return {
      kind: "unsupported",
      reason: "mp4 needs re-encoding but no WebCodecs encoder or system ffmpeg is available",
    };
  }

  if (mp4Playable(video, audio)) return { kind: "copy", container: "mp4" };
  if (webmPlayable(video, audio)) return { kind: "copy", container: "webm" };
  // Mismatched codecs (e.g. AVC+Opus, VP9+AAC): copy losslessly into mkv (archive).
  return { kind: "copy", container: "mkv" };
}
