/**
 * AsrProvider — the pluggable boundary between MUZERO's microphone-capture
 * orchestration and whatever service turns recorded audio into text. Mirrors the
 * {@link MusicGenProvider} discipline: the recorder never knows which vendor it's
 * talking to, and vendor-specific request/response mapping is isolated in pure
 * functions (see `groq-mapping.ts`).
 *
 * MUZERO ships a single provider today:
 *  - `groq` — Groq Whisper (`whisper-large-v3-turbo`), BYOK, called directly
 *             through {@link getAppFetch} (CORS-safe).
 *
 * Add more by implementing this interface and registering it in `registry.ts`.
 */

/** Codename-stable provider ids (CLAUDE.md rule 4). Extend the union to add one. */
export type AsrProviderId = "groq";

export interface AsrTranscribeInput {
  /** The recorded audio to transcribe. */
  blob: Blob;
  /** ISO-639-1 language hint; omit / "auto" lets the model detect. */
  language?: string;
  /** Abort an in-flight transcription (recording cancelled, app closing, …). */
  signal?: AbortSignal;
}

export interface AsrResult {
  /** The transcribed text (may be empty for silence / too-short audio). */
  text: string;
  /** Remaining audio-seconds quota, parsed from response headers when present. */
  remainingAudioSeconds?: number;
  /** Remaining request quota, parsed from response headers when present. */
  remainingRequests?: number;
}

export interface AsrProvider {
  readonly id: AsrProviderId;
  transcribe(input: AsrTranscribeInput): Promise<AsrResult>;
}

/**
 * Coarse error taxonomy so the UI can show an actionable message without leaking
 * vendor specifics: bad key, throttled, offline, or something else.
 */
export type AsrErrorKind = "auth" | "rate-limit" | "network" | "unknown";

export class AsrError extends Error {
  constructor(
    message: string,
    readonly kind: AsrErrorKind,
    readonly provider: AsrProviderId,
    readonly statusCode?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AsrError";
  }
}
