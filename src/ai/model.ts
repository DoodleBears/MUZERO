import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { AppSettings } from "@/db/types";
import { getAppFetch } from "@/lib/platform";

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
export async function resolveDjModel(settings: AppSettings): Promise<LanguageModel> {
  const fetch = await getAppFetch();
  switch (settings.llmProvider) {
    case "anthropic": {
      if (!settings.anthropicApiKey) throw new MissingApiKeyError("anthropic");
      const anthropic = createAnthropic({ apiKey: settings.anthropicApiKey, fetch });
      return anthropic(settings.llmModel || "claude-haiku-4-5-20251001");
    }
    default: {
      if (!settings.openaiApiKey) throw new MissingApiKeyError("openai");
      const openai = createOpenAI({ apiKey: settings.openaiApiKey, fetch });
      return openai(settings.llmModel || "gpt-4o-mini");
    }
  }
}
