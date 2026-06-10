/**
 * Resolve the active lyrics provider from settings. Pluggable boundary (mirrors
 * `musicgen/registry.ts`): to add a source, extend `LyricsProviderId`, implement
 * `LyricsProvider`, and add a branch here — never scatter `if (source === …)`.
 *
 *  - `lrclib`  — LRCLIB (default): free, keyless, great for Western catalogues.
 *  - `netease` — NetEase Cloud Music: huge CJK catalogue + official synced LRC.
 *                For a streamed NetEase track its songId gives the EXACT lyrics, so
 *                those always use NetEase via {@link resolveLyricsProviderForTrack}.
 *  - `amll`    — AMLL TTML DB (opt-in): word-by-word TTML keyed by NetEase songId.
 *                Exact source (no text search); resolves only NetEase-id tracks.
 */

import type { AppSettings, Track } from "@/db/types";
import { createStreamHttp } from "@/streamsrc/stream-http";
import { createAmllTtmlProvider } from "./amll-ttml-provider";
import { createLrclibProvider } from "./lrclib-provider";
import { createNeteaseLyricsProvider } from "./netease-lyrics-provider";
import type { LyricsProvider, LyricsProviderId } from "./provider";

export const LYRICS_PROVIDER_IDS: LyricsProviderId[] = ["lrclib", "netease", "amll"];

function createNetease(settings: AppSettings): LyricsProvider {
  return createNeteaseLyricsProvider({
    http: createStreamHttp(),
    getCookie: () => settings.streamSources?.netease?.cookie,
  });
}

/** The user-selected global lyrics provider (default LRCLIB). */
export function resolveLyricsProvider(settings: AppSettings): LyricsProvider {
  switch (settings.lyricsProviderId) {
    case "netease":
      return createNetease(settings);
    case "amll":
      return createAmllTtmlProvider();
    default:
      return createLrclibProvider();
  }
}

/**
 * Provider for a specific track. A streamed NetEase track resolves by its songId
 * to exact lyrics — AMLL TTML when the user opted into it, else NetEase — regardless
 * of the global setting; everything else uses the user's choice.
 */
export function resolveLyricsProviderForTrack(settings: AppSettings, track: Track): LyricsProvider {
  if (track.streamSourceId === "netease" && track.streamExternalId) {
    return settings.lyricsProviderId === "amll"
      ? createAmllTtmlProvider()
      : createNetease(settings);
  }
  return resolveLyricsProvider(settings);
}
