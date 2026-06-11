import { apiKeyForPreset, LLM_PROVIDER_PRESET_IDS } from "@/ai/llm-providers";
import type { AppSettings } from "@/db/types";
import { resolveCloudPreset } from "@/musicgen/presets";

/**
 * Gate for the DJ chat entry (PRD §5.1): the entry — including its icon — only
 * renders when BOTH a usable LLM and a usable music-gen provider are
 * configured. Pure over AppSettings so the rule is exhaustively unit-tested
 * and the dock component stays a thin `canUseDjChat(settings)` check.
 */

/** Any provider preset with a non-blank key (incl. the legacy openai/anthropic fields). */
export function hasUsableLlm(settings: AppSettings): boolean {
  return LLM_PROVIDER_PRESET_IDS.some((id) => Boolean(apiKeyForPreset(settings, id)?.trim()));
}

/**
 * The selected music provider can actually generate: the offline mock always
 * can; cloud needs a key, and the custom (user-endpoint) preset also needs its
 * base URL. Mirrors what `resolveMusicGenProvider` would wire up — without
 * instantiating a provider.
 */
export function hasUsableMusicgen(settings: AppSettings): boolean {
  if (settings.musicGenProvider !== "cloud") return true;
  if (!settings.musicCloudApiKey?.trim()) return false;
  const preset = resolveCloudPreset(settings.musicCloudPreset);
  return preset.fixedEndpoint || Boolean(settings.musicCloudUrl?.trim());
}

export function canUseDjChat(settings: AppSettings): boolean {
  return hasUsableLlm(settings) && hasUsableMusicgen(settings);
}
