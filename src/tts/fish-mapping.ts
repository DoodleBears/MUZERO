/**
 * Vendor-specific pure functions for the Fish Audio TTS provider — the TTS mirror
 * of `musicgen/cloud-provider.ts`'s mappers. Swapping vendors edits only these;
 * the list/get/synthesize flow and the registry stay put. Kept pure so the
 * request body, model normalization, and error classification are unit-testable
 * without network.
 *
 * Fish Audio TTS: https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
 */

import type { TtsErrorKind, VoiceModel, VoiceModelSample } from "./provider";

export const FISH_API_BASE = "https://api.fish.audio";

/** Fish synthesis backend, sent as the `model` header on `/v1/tts`. */
export type FishTtsBackend = "s1" | "s2-pro";
export type TtsAudioFormat = "mp3" | "opus";

export interface MapReplyOptions {
  format: TtsAudioFormat;
  mp3Bitrate?: number;
}

/** Build the `/v1/tts` request body for one reply line. */
export function mapReplyToTtsBody(
  input: { text: string; voiceId: string; speed?: number },
  opts: MapReplyOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text: input.text,
    reference_id: input.voiceId,
    format: opts.format,
    chunk_length: 300,
    normalize: true,
    latency: "normal",
    prosody: { speed: input.speed ?? 1, volume: 0 },
    temperature: 0.7,
    top_p: 0.7,
  };
  if (opts.format === "mp3") body.mp3_bitrate = opts.mp3Bitrate ?? 128;
  return body;
}

/** Normalize one Fish `ModelEntity` into the internal {@link VoiceModel}. */
export function parseVoiceModel(json: unknown): VoiceModel {
  const obj = (json ?? {}) as Record<string, unknown>;
  const id = pickString(obj, ["_id", "id"]) ?? "";
  const rawSamples = Array.isArray(obj.samples) ? obj.samples : [];
  const samples: VoiceModelSample[] = rawSamples
    .map((s): VoiceModelSample | null => {
      const sample = (s ?? {}) as Record<string, unknown>;
      const audio = typeof sample.audio === "string" ? sample.audio : "";
      if (!audio) return null;
      return { audio, text: typeof sample.text === "string" ? sample.text : undefined };
    })
    .filter((s): s is VoiceModelSample => s !== null);
  return {
    id,
    title: typeof obj.title === "string" ? obj.title : id,
    description: typeof obj.description === "string" ? obj.description : undefined,
    coverImage: pickString(obj, ["cover_image", "coverImage"]),
    samples,
    tags: stringArray(obj.tags),
    languages: stringArray(obj.languages),
  };
}

/** Normalize a Fish `PaginatedResponse<ModelEntity>` into a list. */
export function parseVoiceModelList(json: unknown): VoiceModel[] {
  const obj = (json ?? {}) as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? obj.items : [];
  return items.map(parseVoiceModel);
}

/** Classify an HTTP status into an actionable {@link TtsErrorKind}. */
export function classifyFishError(status: number): TtsErrorKind {
  if (status === 401 || status === 402 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  return "unknown";
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
