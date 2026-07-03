/**
 * TtsProvider — the pluggable boundary between MUZERO and whatever service turns
 * the DJ's reply text into speech. The TTS mirror of {@link AsrProvider}: the
 * caller never knows which vendor speaks, and vendor request/response mapping is
 * isolated in pure functions (see `fish-mapping.ts`).
 *
 * MUZERO ships one provider today:
 *  - `fish-audio` — Fish Audio (BYOK), called directly through {@link getAppFetch}.
 *
 * Add more by implementing this interface and registering it in `registry.ts`.
 */

/** Codename-stable provider ids (CLAUDE.md rule 4). */
export type TtsProviderId = "fish-audio";

/** A usable voice, normalized from a vendor model entity. */
export interface VoiceModelSample {
  /** URL to a short preview clip. */
  audio: string;
  text?: string;
}

export interface VoiceModel {
  id: string;
  title: string;
  description?: string;
  coverImage?: string;
  samples: VoiceModelSample[];
  tags: string[];
  languages: string[];
}

export interface TtsSynthesizeInput {
  text: string;
  /** The selected voice model id (Fish `reference_id`). */
  voiceId: string;
  /** Playback rate 0.5–2.0. */
  speed?: number;
  signal?: AbortSignal;
}

export interface TtsResult {
  blob: Blob;
  /** MIME of the synthesized audio, e.g. "audio/mpeg". */
  mime: string;
}

export interface ListVoicesOptions {
  /** Substring/title search. */
  query?: string;
  /** Only the API key owner's voices (`self_only=true`). */
  ownedOnly?: boolean;
  signal?: AbortSignal;
}

export interface TtsProvider {
  readonly id: TtsProviderId;
  synthesize(input: TtsSynthesizeInput): Promise<TtsResult>;
  listVoices(opts: ListVoicesOptions): Promise<VoiceModel[]>;
  getVoice(id: string, signal?: AbortSignal): Promise<VoiceModel | null>;
}

export type TtsErrorKind = "auth" | "rate-limit" | "network" | "unknown";

export class TtsError extends Error {
  constructor(
    message: string,
    readonly kind: TtsErrorKind,
    readonly provider: TtsProviderId,
    readonly statusCode?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TtsError";
  }
}
