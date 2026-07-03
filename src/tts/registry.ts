/**
 * TTS provider registry — the single decision point that turns on-device settings
 * into a concrete {@link TtsProvider}, mirroring `asr/registry.ts`. Nowhere else
 * should branch on `settings.ttsProvider` (CLAUDE.md rule 5).
 */

import type { AppSettings } from "@/db/types";
import { DEFAULT_FISH_BACKEND, type FishTtsBackend, type TtsAudioFormat } from "./fish-mapping";
import { createFishTtsProvider } from "./fish-provider";
import type { TtsProvider, TtsProviderId } from "./provider";

export const TTS_PROVIDER_IDS: TtsProviderId[] = ["fish-audio"];

/**
 * Resolve a TTS provider from the configured API key — usable for listing /
 * previewing voices as soon as a key is set. Returns `null` when no key is set.
 * The speak path additionally gates on {@link isTtsReady}.
 */
export function resolveTtsProvider(settings: AppSettings): TtsProvider | null {
  switch (settings.ttsProvider ?? "fish-audio") {
    default: {
      const apiKey = settings.fishAudioApiKey?.trim();
      if (!apiKey) return null;
      return createFishTtsProvider({
        apiKey,
        backend: (settings.ttsModel as FishTtsBackend | undefined) ?? DEFAULT_FISH_BACKEND,
        format: (settings.ttsFormat as TtsAudioFormat | undefined) ?? "mp3",
      });
    }
  }
}

/** Whether the DJ can actually speak: a key + a selected voice are configured.
 *  (No separate master switch — a single "auto-speak" toggle drives speaking; see
 *  `djReplyAutoSpeak`.) */
export function isTtsReady(settings: AppSettings): boolean {
  return Boolean(settings.fishAudioApiKey?.trim()) && Boolean(settings.ttsVoiceId);
}
