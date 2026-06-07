import type { AppSettings, LlmProviderId } from "@/db/types";

export type LlmProviderPresetId =
  | "openrouter"
  | "openai"
  | "claude"
  | "gemini"
  | "groq"
  | "deepseek"
  | "custom";

export interface LlmModelPreset {
  id: string;
  label: string;
  contextLimit?: number;
  inputCostPerMillionUsd?: number;
  outputCostPerMillionUsd?: number;
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

export const LLM_PROVIDER_PRESETS: Record<LlmProviderPresetId, LlmProviderPreset> = {
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

export const LLM_PROVIDER_PRESET_IDS = Object.keys(LLM_PROVIDER_PRESETS) as LlmProviderPresetId[];

export function resolveLlmProviderPreset(id: string | undefined): LlmProviderPreset {
  return (
    LLM_PROVIDER_PRESETS[(id as LlmProviderPresetId | undefined) ?? "openai"] ??
    LLM_PROVIDER_PRESETS.openai
  );
}

export function defaultModelForPreset(id: string | undefined): string {
  return resolveLlmProviderPreset(id).models[0]?.id ?? "gpt-4o-mini";
}

export function legacyPresetFor(provider: LlmProviderId): LlmProviderPresetId {
  return provider === "anthropic" ? "claude" : "openai";
}

export function llmSelectionFromSettings(settings: AppSettings): LlmSelection {
  const presetId = settings.defaultLlmProviderPresetId ?? legacyPresetFor(settings.llmProvider);
  const model = settings.defaultLlmModel ?? (settings.llmModel || defaultModelForPreset(presetId));
  return {
    presetId,
    model,
    apiKey: apiKeyForPreset(settings, presetId),
  };
}

export function llmSelectionForChatSession(
  settings: AppSettings,
  session: LlmSessionSelectionOverride | undefined,
): LlmSelection {
  const base = llmSelectionFromSettings(settings);
  const presetId =
    (session?.llmProviderPresetId as LlmProviderPresetId | undefined) ?? base.presetId;
  const model =
    session?.llmModel?.trim() ||
    (presetId === base.presetId ? base.model : defaultModelForPreset(presetId));
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

export function enabledLlmPresetIds(settings: AppSettings): LlmProviderPresetId[] {
  return LLM_PROVIDER_PRESET_IDS.filter((id) => Boolean(apiKeyForPreset(settings, id)));
}
