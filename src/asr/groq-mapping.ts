/**
 * Vendor-specific pure functions for the Groq Whisper ASR provider — the ASR
 * mirror of `musicgen/cloud-provider.ts`'s three mappers. Swapping vendors means
 * editing only these; the recorder / registry / provider flow stay put. Kept pure
 * so MIME→extension mapping, form building, response parsing, and error
 * classification are exhaustively unit-testable without network or a microphone.
 *
 * Groq STT: https://console.groq.com/docs/speech-to-text
 */

import type { AsrErrorKind, AsrResult } from "./provider";

export const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/** Whisper models Groq exposes. Turbo is the default: faster + cheaper, plenty
 *  accurate for short spoken DJ commands. */
export type GroqWhisperModel = "whisper-large-v3-turbo" | "whisper-large-v3";

export const DEFAULT_GROQ_MODEL: GroqWhisperModel = "whisper-large-v3-turbo";

const MIME_EXTENSION: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

/** Map a (possibly parameterized) MIME type to the file extension Groq expects. */
export function extensionFromMime(mime: string): string {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_EXTENSION[base] ?? "webm";
}

export interface BuildTranscribeFormOptions {
  model: string;
  /** ISO-639-1 code; "auto"/""/undefined omits the field so Groq auto-detects. */
  language?: string;
  responseFormat?: "json" | "text" | "verbose_json";
  temperature?: number;
}

/**
 * Build the `multipart/form-data` body for a transcription request. The file is
 * named by its MIME-derived extension so Groq's container sniffing succeeds.
 */
export function buildTranscribeForm(blob: Blob, opts: BuildTranscribeFormOptions): FormData {
  const form = new FormData();
  const extension = extensionFromMime(blob.type || "audio/webm");
  form.append("file", blob, `audio.${extension}`);
  form.append("model", opts.model);
  form.append("response_format", opts.responseFormat ?? "json");
  form.append("temperature", String(opts.temperature ?? 0));
  if (opts.language && opts.language !== "auto") {
    form.append("language", opts.language);
  }
  return form;
}

/** Parse Groq's JSON response (+ optional headers) into an {@link AsrResult}. */
export function parseTranscript(
  json: unknown,
  headers?: { get(name: string): string | null },
): AsrResult {
  const obj = (json ?? {}) as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text : "";
  return {
    text,
    remainingAudioSeconds: parseIntOrUndefined(headers?.get("x-ratelimit-remaining-audio-seconds")),
    remainingRequests: parseIntOrUndefined(headers?.get("x-ratelimit-remaining-requests")),
  };
}

/** Classify an HTTP status into an actionable {@link AsrErrorKind}. */
export function classifyGroqError(status: number): AsrErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  return "unknown";
}

function parseIntOrUndefined(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
