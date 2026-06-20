/**
 * Pure YouTube adaptive-audio selection — the InnerTube `/player` response carries
 * `streamingData.adaptiveFormats[]` (separate audio + video streams). MUZERO is
 * audio-first, so we pick the best audio-only format. Mirrors `bili-resolve.ts`'s
 * DASH track picker: zero IO, exhaustively unit-tested.
 *
 * Preference (streaming PRD Phase 4): MP4/AAC over WebM/Opus (broadest Chromium +
 * WebAudio compatibility), then highest bitrate. The URL may be direct or hidden
 * behind a `signatureCipher` (resolved later by the sig solver).
 */

export interface YoutubeFormat {
  itag: number;
  /** e.g. `audio/mp4; codecs="mp4a.40.2"` or `audio/webm; codecs="opus"`. */
  mimeType: string;
  bitrate?: number;
  averageBitrate?: number;
  contentLength?: string;
  /** Direct media URL (present when the stream isn't ciphered). */
  url?: string;
  /** `s=…&sp=sig&url=…` — the signature must be solved + appended (ciphered streams). */
  signatureCipher?: string;
  /** Older field name for the same ciphered payload (still emitted by some clients). */
  cipher?: string;
  audioQuality?: string;
  audioSampleRate?: string;
  audioChannels?: number;
}

export type AudioCodec = "aac" | "opus" | "vorbis" | "other";

export interface PickedAudio {
  format: YoutubeFormat;
  codec: AudioCodec;
}

/** Classify an audio format's codec from its mimeType. */
export function audioCodecOf(mimeType: string): AudioCodec {
  const m = mimeType.toLowerCase();
  if (m.includes("mp4a")) return "aac";
  if (m.includes("opus")) return "opus";
  if (m.includes("vorbis")) return "vorbis";
  return "other";
}

/** Compatibility-first codec tier (lower = preferred): AAC, then Opus, then the rest. */
const CODEC_TIER: Record<AudioCodec, number> = { aac: 0, opus: 1, vorbis: 2, other: 3 };

function isAudioOnly(format: YoutubeFormat): boolean {
  return format.mimeType.toLowerCase().startsWith("audio/");
}

function bitrateOf(format: YoutubeFormat): number {
  return format.bitrate ?? format.averageBitrate ?? 0;
}

/**
 * Pick the best audio-only format: MP4/AAC preferred over WebM/Opus, then the
 * highest bitrate within the chosen codec. Returns null if there's no audio stream.
 */
export function pickAdaptiveAudio(formats: YoutubeFormat[]): PickedAudio | null {
  const audio = formats.filter(isAudioOnly);
  if (audio.length === 0) return null;
  const ranked = audio
    .map((format) => ({ format, codec: audioCodecOf(format.mimeType) }))
    .sort((a, b) => {
      const tier = CODEC_TIER[a.codec] - CODEC_TIER[b.codec];
      if (tier !== 0) return tier;
      return bitrateOf(b.format) - bitrateOf(a.format);
    });
  return ranked[0];
}

/** The mime to hand the media element for a picked format (codecs stripped). */
export function audioMimeFor(format: YoutubeFormat): string {
  // `audio/mp4; codecs="mp4a.40.2"` → `audio/mp4`; <audio> doesn't want the codecs.
  return format.mimeType.split(";")[0].trim() || "audio/mp4";
}

// --- Video-only adaptive selection (download): mirrors the audio picker but keyed on
// resolution, and mirrors bili-video's selectVideoByResolution. Pure, exhaustively tested.

export type VideoCodecKind = "avc" | "vp9" | "av1" | "other";

export interface YoutubeVideoFormat {
  itag: number;
  /** e.g. `video/mp4; codecs="avc1.640028"` or `video/webm; codecs="vp9"`. */
  mimeType: string;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  qualityLabel?: string;
}

export interface PickedVideo {
  format: YoutubeVideoFormat;
  codec: VideoCodecKind;
}

/** Classify a video format's codec from its mimeType. */
export function videoCodecOf(mimeType: string): VideoCodecKind {
  const m = mimeType.toLowerCase();
  if (m.includes("avc1") || m.includes("h264")) return "avc";
  if (m.includes("vp9") || m.includes("vp09")) return "vp9";
  if (m.includes("av01") || m.includes("av1")) return "av1";
  return "other";
}

/** Container-compat default (AVC-first → mp4 copy with AAC; NOT a quality ranking). */
const VIDEO_CODEC_ORDER: VideoCodecKind[] = ["avc", "vp9", "av1", "other"];

export interface PickVideoOptions {
  /** Cap the resolution (height in px). Omit = pick the highest available. */
  maxHeight?: number;
  codecPreference?: VideoCodecKind[];
}

function videoOnly(formats: YoutubeVideoFormat[]): YoutubeVideoFormat[] {
  return formats.filter((f) => f.mimeType.toLowerCase().startsWith("video/"));
}

function heightOf(f: YoutubeVideoFormat): number {
  return f.height ?? 0;
}

/**
 * Pick the best video-only format for a target height: prefer the highest height ≤
 * `maxHeight` (downgrade from the cap); if all are above the cap, take the lowest
 * (minimal upgrade); with no cap, take the highest. Within the chosen height, order by
 * `codecPreference` (AVC-first) then by highest bitrate. Null if there are no formats.
 */
export function pickAdaptiveVideo(
  formats: YoutubeVideoFormat[],
  opts: PickVideoOptions = {},
): PickedVideo | null {
  const candidates = videoOnly(formats);
  if (!candidates.length) return null;
  const { maxHeight, codecPreference = VIDEO_CODEC_ORDER } = opts;

  const heights = [...new Set(candidates.map(heightOf))].sort((a, b) => a - b);
  let targetHeight: number;
  if (maxHeight === undefined) {
    targetHeight = heights[heights.length - 1];
  } else {
    const eligible = heights.filter((h) => h <= maxHeight);
    targetHeight = eligible.length ? eligible[eligible.length - 1] : heights[0];
  }

  const codecRank = (codec: VideoCodecKind): number => {
    const i = codecPreference.indexOf(codec);
    return i === -1 ? codecPreference.length : i;
  };

  const best = candidates
    .filter((f) => heightOf(f) === targetHeight)
    .map((format) => ({ format, codec: videoCodecOf(format.mimeType) }))
    .sort(
      (a, b) =>
        codecRank(a.codec) - codecRank(b.codec) ||
        (b.format.bitrate ?? 0) - (a.format.bitrate ?? 0),
    )[0];
  return best ?? null;
}

/** The mime to store/play a picked video format (codecs stripped). */
export function videoMimeFor(format: YoutubeVideoFormat): string {
  return format.mimeType.split(";")[0].trim() || "video/mp4";
}
