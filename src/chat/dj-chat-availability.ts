import { apiKeyForPreset, LLM_PROVIDER_PRESET_IDS } from "@/ai/llm-providers";
import type { AppSettings, StreamSourceId } from "@/db/types";
import { resolveCloudPreset } from "@/musicgen/presets";

/**
 * Gates for the DJ chat (PRD §5.1):
 *  - `canUseDjChat` — the dock entry (incl. its icon) renders only when a usable
 *    LLM is configured. Music generation is NOT required: the chat is useful for
 *    searching + ingesting songs from streaming sources (cheap, and works with a
 *    locally-hosted LLM) even with no music-gen provider.
 *  - `canGenerateMusic` — whether the paid generate tools may be offered at all
 *    (the user opted in via Settings AND a cloud BYOK provider is configured).
 *  - `hasEnabledStreamSources` — whether the online search/ingest tools apply.
 *
 * Pure over AppSettings so the rules are exhaustively unit-tested and the dock /
 * agent stay thin call sites.
 */

/** Codename-stable streaming source ids (rule 4); inlined to keep this module light. */
const STREAM_SOURCE_IDS: readonly StreamSourceId[] = ["netease", "bili", "youtube"];

/** Any provider preset with a non-blank key (incl. the legacy openai/anthropic fields). */
export function hasUsableLlm(settings: AppSettings): boolean {
  return LLM_PROVIDER_PRESET_IDS.some((id) => Boolean(apiKeyForPreset(settings, id)?.trim()));
}

/**
 * AI music generation is available only when the user enabled it (OFF by
 * default) AND a cloud BYOK provider is configured: a key, plus a base URL for
 * the user-endpoint "custom" preset (fixed-endpoint presets like Mureka bake
 * theirs in). There is no offline/local generation option.
 */
export function canGenerateMusic(settings: AppSettings): boolean {
  if (!settings.aiDjGenerationEnabled) return false;
  if (!settings.musicCloudApiKey?.trim()) return false;
  const preset = resolveCloudPreset(settings.musicCloudPreset);
  return preset.fixedEndpoint || Boolean(settings.musicCloudUrl?.trim());
}

/** Whether any external streaming source (YouTube / Bilibili / NetEase) is enabled. */
export function hasEnabledStreamSources(settings: AppSettings): boolean {
  return STREAM_SOURCE_IDS.some((id) => settings.streamSources?.[id]?.enabled === true);
}

export function canUseDjChat(settings: AppSettings): boolean {
  return hasUsableLlm(settings);
}
