/**
 * ASR provider registry — the single decision point that turns on-device settings
 * into a concrete {@link AsrProvider}, mirroring `musicgen/registry.ts`. Nowhere
 * else in the app should branch on `settings.asrProvider` (CLAUDE.md rule 5).
 */

import type { AppSettings } from "@/db/types";
import type { GroqWhisperModel } from "./groq-mapping";
import { createGroqAsrProvider } from "./groq-provider";
import type { AsrProvider, AsrProviderId } from "./provider";

export const ASR_PROVIDER_IDS: AsrProviderId[] = ["groq"];

/**
 * The Groq key for ASR: the ASR-specific `groqApiKey`, else a fall-back to the
 * DJ's already-configured Groq LLM key (`apiKeysByPresetId.groq`) so users who've
 * set up Groq for the DJ don't re-enter it (PRD Q6, default "reuse").
 */
export function resolveGroqApiKey(settings: AppSettings): string | undefined {
  const own = settings.groqApiKey?.trim();
  if (own) return own;
  return settings.apiKeysByPresetId?.groq?.trim() || undefined;
}

/** Resolve the active ASR provider, or `null` when nothing is configured. */
export function resolveAsrProvider(settings: AppSettings): AsrProvider | null {
  switch (settings.asrProvider ?? "groq") {
    default: {
      const apiKey = resolveGroqApiKey(settings);
      if (!apiKey) return null;
      return createGroqAsrProvider({
        apiKey,
        model: (settings.asrModel as GroqWhisperModel | undefined) ?? undefined,
      });
    }
  }
}

/** Whether a usable ASR provider can be built from these settings. */
export function isAsrConfigured(settings: AppSettings): boolean {
  return resolveAsrProvider(settings) !== null;
}
