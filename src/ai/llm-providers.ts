import type { AppSettings, CustomLlmProvider, LlmProviderId } from "@/db/types";
import { customLlmProviderToPreset, isCustomLlmProviderId } from "./custom-llm-providers";

export type BuiltinLlmProviderPresetId =
  | "openrouter"
  | "openai"
  | "claude"
  | "gemini"
  | "groq"
  | "deepseek"
  | "custom";

/** Built-ins plus user-defined `custom:<uuid>` providers (Dexie-backed). */
export type LlmProviderPresetId = BuiltinLlmProviderPresetId | `custom:${string}`;

export interface LlmModelPreset {
  id: string;
  label: string;
  contextLimit?: number;
  inputCostPerMillionUsd?: number;
  outputCostPerMillionUsd?: number;
  /** Accepts image input (vision). */
  supportsVision?: boolean;
  /** Accepts audio input. */
  supportsAudio?: boolean;
  /** Supports function/tool calling. */
  supportsTools?: boolean;
}

export interface LlmProviderPreset {
  id: LlmProviderPresetId;
  label: string;
  provider: "openai-compatible" | "anthropic";
  baseURL?: string;
  apiKeyUrl?: string;
  docsUrl?: string;
  models: LlmModelPreset[];
}

export interface LlmSelection {
  presetId: LlmProviderPresetId;
  model: string;
  apiKey?: string;
}

export interface LlmSessionSelectionOverride {
  llmProviderPresetId?: string;
  llmModel?: string;
}

export const LLM_PROVIDER_PRESETS: Record<BuiltinLlmProviderPresetId, LlmProviderPreset> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    provider: "openai-compatible",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyUrl: "https://openrouter.ai/keys",
    docsUrl: "https://openrouter.ai/docs",
    models: [
      { id: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini", contextLimit: 1_000_000 },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", contextLimit: 200_000 },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    provider: "openai-compatible",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini", contextLimit: 128_000 },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini", contextLimit: 1_000_000 },
    ],
  },
  claude: {
    id: "claude",
    label: "Claude",
    provider: "anthropic",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", contextLimit: 200_000 },
      { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", contextLimit: 200_000 },
    ],
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    provider: "openai-compatible",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", contextLimit: 1_000_000 },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", contextLimit: 1_000_000 },
    ],
  },
  groq: {
    id: "groq",
    label: "Groq",
    provider: "openai-compatible",
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyUrl: "https://console.groq.com/keys",
    models: [{ id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", contextLimit: 128_000 }],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    provider: "openai-compatible",
    baseURL: "https://api.deepseek.com",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat", contextLimit: 64_000 },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", contextLimit: 64_000 },
    ],
  },
  custom: {
    id: "custom",
    label: "Custom OpenAI-compatible",
    provider: "openai-compatible",
    models: [{ id: "custom-model", label: "Custom model" }],
  },
};

export const LLM_PROVIDER_PRESET_IDS = Object.keys(
  LLM_PROVIDER_PRESETS,
) as BuiltinLlmProviderPresetId[];

/** Built-ins followed by the user's dynamic custom providers (Settings order). */
export function allLlmProviderPresets(custom: CustomLlmProvider[] = []): LlmProviderPreset[] {
  return [
    ...LLM_PROVIDER_PRESET_IDS.map((id) => LLM_PROVIDER_PRESETS[id]),
    ...custom.map(customLlmProviderToPreset),
  ];
}

export function resolveLlmProviderPreset(
  id: string | undefined,
  custom: CustomLlmProvider[] = [],
): LlmProviderPreset {
  if (isCustomLlmProviderId(id)) {
    const match = custom.find((provider) => provider.id === id);
    if (match) return customLlmProviderToPreset(match);
  }
  return (
    LLM_PROVIDER_PRESETS[(id as BuiltinLlmProviderPresetId | undefined) ?? "openai"] ??
    LLM_PROVIDER_PRESETS.openai
  );
}

/** Dynamic custom endpoints may run keyless (local vLLM/ollama-style servers). */
export function llmProviderAllowsMissingApiKey(id: string | undefined): boolean {
  return isCustomLlmProviderId(id);
}

/**
 * Normalize a user-supplied OpenAI-compatible base URL (ClipCombo parity):
 * trim, drop trailing slashes, and append `/v1` unless the path already ends
 * in a versioned segment (`/v1`, `/v1beta/openai`, …).
 */
export function normalizeOpenAiCompatibleBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  if (/\/v\d+(beta\/openai)?$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

export function defaultModelForPreset(
  id: string | undefined,
  custom: CustomLlmProvider[] = [],
): string {
  return resolveLlmProviderPreset(id, custom).models[0]?.id ?? "gpt-4o-mini";
}

/**
 * The model to show/use when switching to a preset: last remembered for that
 * preset → current setting if the preset knows it → the preset's first model
 * (ClipCombo's `editorLlmModelForPreset`).
 */
export function llmModelForPreset(
  settings: Pick<AppSettings, "modelsByPresetId">,
  preset: LlmProviderPreset,
): string {
  // Trust ANY remembered model: with the live `/models` catalog and free-text
  // custom ids, a user-picked model legitimately may not be in the preset's
  // hardcoded list — validating against it would silently snap the picker back
  // to the default and make model switching look like it had no effect.
  const remembered = settings.modelsByPresetId?.[preset.id]?.trim();
  if (remembered) return remembered;
  return preset.models[0]?.id ?? "gpt-4o-mini";
}

export function legacyPresetFor(provider: LlmProviderId): LlmProviderPresetId {
  return provider === "anthropic" ? "claude" : "openai";
}

export function llmSelectionFromSettings(
  settings: AppSettings,
  custom: CustomLlmProvider[] = [],
): LlmSelection {
  const presetId = settings.defaultLlmProviderPresetId ?? legacyPresetFor(settings.llmProvider);
  const model =
    settings.defaultLlmModel ?? (settings.llmModel || defaultModelForPreset(presetId, custom));
  return {
    presetId,
    model,
    apiKey: apiKeyForPreset(settings, presetId),
  };
}

export function llmSelectionForChatSession(
  settings: AppSettings,
  session: LlmSessionSelectionOverride | undefined,
  custom: CustomLlmProvider[] = [],
): LlmSelection {
  const base = llmSelectionFromSettings(settings, custom);
  const presetId =
    (session?.llmProviderPresetId as LlmProviderPresetId | undefined) ?? base.presetId;
  const model =
    session?.llmModel?.trim() ||
    (presetId === base.presetId ? base.model : defaultModelForPreset(presetId, custom));
  return {
    presetId,
    model,
    apiKey: apiKeyForPreset(settings, presetId),
  };
}

export function apiKeyForPreset(
  settings: AppSettings,
  presetId: LlmProviderPresetId,
): string | undefined {
  return (
    settings.apiKeysByPresetId?.[presetId] ??
    (presetId === "openai" ? settings.openaiApiKey : undefined) ??
    (presetId === "claude" ? settings.anthropicApiKey : undefined)
  );
}

/**
 * Presets selectable in the model picker: built-ins with a key, plus every
 * dynamic custom provider (their key is optional — keyless local endpoints).
 */
export function enabledLlmPresetIds(
  settings: AppSettings,
  custom: CustomLlmProvider[] = [],
): LlmProviderPresetId[] {
  return [
    ...LLM_PROVIDER_PRESET_IDS.filter((id) => Boolean(apiKeyForPreset(settings, id))),
    ...custom.map((provider) => provider.id),
  ];
}
