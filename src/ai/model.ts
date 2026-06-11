import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { AppSettings, CustomLlmProvider } from "@/db/types";
import { getAppFetch } from "@/lib/platform";
import { isCustomLlmProviderId } from "./custom-llm-providers";
import {
  type LlmSelection,
  llmProviderAllowsMissingApiKey,
  llmSelectionFromSettings,
  normalizeOpenAiCompatibleBaseUrl,
  resolveLlmProviderPreset,
} from "./llm-providers";

export class MissingApiKeyError extends Error {
  constructor(readonly provider: string) {
    super(`No API key configured for ${provider}. Add one in Settings.`);
    this.name = "MissingApiKeyError";
  }
}

/**
 * Wrap a fetch so the OpenAI client's `Authorization: Bearer <placeholder>`
 * never reaches a keyless local endpoint (ClipCombo's
 * `fetchWithoutAuthorization`). Exported for unit tests.
 */
export function fetchWithoutAuthorization(base: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    return base(input, { ...init, headers });
  };
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
  custom: CustomLlmProvider[] = [],
): Promise<LanguageModel> {
  const appFetch = await getAppFetch();
  const preset = resolveLlmProviderPreset(selection.presetId, custom);
  const apiKey = selection.apiKey?.trim();
  const keyless = !apiKey && llmProviderAllowsMissingApiKey(selection.presetId);
  if (!apiKey && !keyless) throw new MissingApiKeyError(selection.presetId);
  switch (preset.provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey,
        baseURL: preset.baseURL,
        fetch: appFetch,
      });
      return anthropic(selection.model);
    }
    default: {
      // Dynamic custom endpoints get URL normalization (user-typed) and may
      // run keyless: a placeholder key satisfies the client while the wrapper
      // strips the Authorization header it would otherwise send.
      const baseURL = isCustomLlmProviderId(preset.id)
        ? normalizeOpenAiCompatibleBaseUrl(preset.baseURL ?? "")
        : preset.baseURL;
      const openai = createOpenAI({
        apiKey: apiKey || "muzero-local-provider",
        baseURL,
        fetch: keyless ? fetchWithoutAuthorization(appFetch) : appFetch,
      });
      return openai(selection.model);
    }
  }
}
