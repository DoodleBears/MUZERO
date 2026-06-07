import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { AppSettings } from "@/db/types";
import { getAppFetch } from "@/lib/platform";
import {
  type LlmSelection,
  llmSelectionFromSettings,
  resolveLlmProviderPreset,
} from "./llm-providers";

export class MissingApiKeyError extends Error {
  constructor(readonly provider: string) {
    super(`No API key configured for ${provider}. Add one in Settings.`);
    this.name = "MissingApiKeyError";
  }
}

/**
 * Resolve a Vercel AI SDK language model from on-device settings (BYOK). The key
 * lives only in IndexedDB and is passed straight to the provider — it is never
 * bundled or sent anywhere but the model API. We hand the provider our
 * CORS-safe fetch so the same call works from a Tauri mobile WebView.
 */
export async function resolveDjModel(
  settings: AppSettings,
  selection: LlmSelection = llmSelectionFromSettings(settings),
): Promise<LanguageModel> {
  const fetch = await getAppFetch();
  const preset = resolveLlmProviderPreset(selection.presetId);
  if (!selection.apiKey) throw new MissingApiKeyError(selection.presetId);
  switch (preset.provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: selection.apiKey,
        baseURL: preset.baseURL,
        fetch,
      });
      return anthropic(selection.model);
    }
    default: {
      const openai = createOpenAI({
        apiKey: selection.apiKey,
        baseURL: preset.baseURL,
        fetch,
      });
      return openai(selection.model);
    }
  }
}
