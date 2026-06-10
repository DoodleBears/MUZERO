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
