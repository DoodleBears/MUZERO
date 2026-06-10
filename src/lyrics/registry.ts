/**
 * Resolve the active lyrics provider from settings. v1 ships only LRCLIB (free,
 * keyless), but the boundary is pluggable: to add a source, extend
 * `LyricsProviderId`, implement `LyricsProvider`, and add a branch here — never
 * scatter `if (source === …)` across store/UI (mirrors `musicgen/registry.ts`).
 */

import type { AppSettings } from "@/db/types";
import { createLrclibProvider } from "./lrclib-provider";
import type { LyricsProvider, LyricsProviderId } from "./provider";

export const LYRICS_PROVIDER_IDS: LyricsProviderId[] = ["lrclib"];

export function resolveLyricsProvider(_settings: AppSettings): LyricsProvider {
  return createLrclibProvider();
}
