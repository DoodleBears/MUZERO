/**
 * Resolve the active lyrics provider from settings. Pluggable boundary (mirrors
 * `musicgen/registry.ts`): to add a source, extend `LyricsProviderId`, implement
 * `LyricsProvider`, and add a branch here — never scatter `if (source === …)`.
 *
 *  - `auto`    — Try the best matching sources in order for the current track.
 *  - `lrclib`  — LRCLIB: free, keyless, great for Western catalogues.
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
import type { LyricsHit, LyricsProvider, LyricsProviderId, LyricsQuery } from "./provider";

export const LYRICS_PROVIDER_IDS: LyricsProviderId[] = ["auto", "lrclib", "netease", "amll"];

function createNetease(settings: AppSettings): LyricsProvider {
  return createNeteaseLyricsProvider({
    http: createStreamHttp(),
    getCookie: () => settings.streamSources?.netease?.cookie,
  });
}

function orderedAutoProviders(settings: AppSettings, q: LyricsQuery): LyricsProvider[] {
  const lrclib = createLrclibProvider();
  const netease = createNetease(settings);
  if (q.neteaseSongId) return [createAmllTtmlProvider(), netease, lrclib];
  return [lrclib, netease];
}

export function createAutoLyricsProvider(
  providersForQuery: (q: LyricsQuery) => LyricsProvider[],
  label = "Auto",
): LyricsProvider {
  async function firstHit(
    q: LyricsQuery,
    signal: AbortSignal | undefined,
    run: (provider: LyricsProvider) => Promise<LyricsHit | null>,
  ): Promise<LyricsHit | null> {
    let lastError: unknown;
    for (const provider of providersForQuery(q)) {
      if (signal?.aborted) return null;
      try {
        const hit = await run(provider);
        if (hit) return hit;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  return {
    id: "auto",
    label,

    fetch(q, signal) {
      return firstHit(q, signal, (provider) => provider.fetch(q, signal));
    },

    async search(q, signal) {
      const out: LyricsHit[] = [];
      const seen = new Set<string>();
      for (const provider of providersForQuery(q)) {
        if (signal?.aborted) return out;
        let hits: LyricsHit[];
        try {
          if (provider.search) hits = await provider.search(q, signal);
          else {
            const hit = await provider.fetch(q, signal);
            hits = hit ? [hit] : [];
          }
        } catch {
          continue;
        }
        for (const hit of hits) {
          const key = `${hit.source}:${hit.sourceId ?? hit.matched.trackName}:${hit.matched.durationSec}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(hit);
        }
      }
      return out;
    },
  };
}

function createAutoProvider(settings: AppSettings): LyricsProvider {
  return createAutoLyricsProvider((q) => orderedAutoProviders(settings, q));
}

/** The user-selected global lyrics provider (default auto). */
export function resolveLyricsProvider(settings: AppSettings): LyricsProvider {
  switch (settings.lyricsProviderId) {
    case "auto":
      return createAutoProvider(settings);
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
 * to exact lyrics — AMLL TTML when the user opted into it, NetEase for concrete
 * LRCLIB/NetEase choices, or source fallback order for auto. Everything else
 * uses the user's global choice.
 */
export function resolveLyricsProviderForTrack(settings: AppSettings, track: Track): LyricsProvider {
  if (track.streamSourceId === "netease" && track.streamExternalId) {
    if (settings.lyricsProviderId === "auto") return createAutoProvider(settings);
    if (settings.lyricsProviderId === "amll") return createAmllTtmlProvider();
    return createNetease(settings);
  }
  return resolveLyricsProvider(settings);
}
