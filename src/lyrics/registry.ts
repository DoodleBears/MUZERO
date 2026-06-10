/**
 * Resolve the active lyrics provider from settings. Pluggable boundary (mirrors
 * `musicgen/registry.ts`): to add a source, extend `LyricsProviderId`, implement
 * `LyricsProvider`, and add a branch here — never scatter `if (source === …)`.
 *
 *  - `lrclib`  — LRCLIB (default): free, keyless, great for Western catalogues.
 *  - `netease` — NetEase Cloud Music: huge CJK catalogue + official synced LRC.
 *                For a streamed NetEase track its songId gives the EXACT lyrics, so
 *                those always use NetEase via {@link resolveLyricsProviderForTrack}.
 */

import type { AppSettings, Track } from "@/db/types";
import { createStreamHttp } from "@/streamsrc/stream-http";
import { createLrclibProvider } from "./lrclib-provider";
import { createNeteaseLyricsProvider } from "./netease-lyrics-provider";
import type { LyricsProvider, LyricsProviderId } from "./provider";

export const LYRICS_PROVIDER_IDS: LyricsProviderId[] = ["lrclib", "netease"];

function createNetease(settings: AppSettings): LyricsProvider {
  return createNeteaseLyricsProvider({
    http: createStreamHttp(),
    getCookie: () => settings.streamSources?.netease?.cookie,
  });
}

/** The user-selected global lyrics provider (default LRCLIB). */
export function resolveLyricsProvider(settings: AppSettings): LyricsProvider {
  return settings.lyricsProviderId === "netease" ? createNetease(settings) : createLrclibProvider();
}

/**
 * Provider for a specific track. A streamed NetEase track always resolves to
 * NetEase (its `streamExternalId` is the songId → exact official lyrics) regardless
 * of the global setting; everything else uses the user's choice.
 */
export function resolveLyricsProviderForTrack(settings: AppSettings, track: Track): LyricsProvider {
  if (track.streamSourceId === "netease" && track.streamExternalId) return createNetease(settings);
  return resolveLyricsProvider(settings);
}
