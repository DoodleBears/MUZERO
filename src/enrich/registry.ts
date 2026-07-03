/**
 * Resolve the active enrichment provider from settings. Pluggable boundary (mirrors
 * `lyrics/registry.ts` / `musicgen/registry.ts`): to add a source, extend `EnrichmentSource`,
 * implement `MetadataEnrichmentProvider`, add a branch in {@link buildProvider}, and (if it
 * should participate by default) in {@link enrichmentProviderOrder} — never scatter
 * `if (source === …)` across DJ / store / UI (rule 5).
 *
 * Strategy: an "auto" composite walks the ordered providers and takes the FIRST that yields
 * genres (short-circuit — rate-friendly). Order puts the best per-track source first:
 *  - QQ 音乐        — native per-track genre (authoritative for CJK); self-skips non-QQ ← always
 *  - Last.fm (BYOK) — densest per-track folksonomy (Western-strong)                    ← if key
 *  - MusicBrainz    — keyless baseline, recording→artist, covers CJK                   ← always
 *  - Discogs (BYOK) — curated style taxonomy                                           ← if token
 */

import type { AppSettings } from "@/db/types";
import { fetchQqNativeGenre } from "@/streamsrc/qq/qq-genre";
import { createStreamHttp } from "@/streamsrc/stream-http";
import { createDiscogsProvider } from "./discogs-provider";
import { createLastfmProvider } from "./lastfm-provider";
import { createMusicbrainzProvider } from "./musicbrainz-provider";
import type {
  EnrichmentHit,
  EnrichmentQuery,
  EnrichmentSource,
  MetadataEnrichmentProvider,
} from "./provider";
import { createQqEnrichmentProvider } from "./qq-provider";

/** The providers to try, in order, for the current settings. MusicBrainz is always present
 *  (keyless baseline); Last.fm / Discogs join only when their BYOK credential is configured. */
export function enrichmentProviderOrder(settings: AppSettings): EnrichmentSource[] {
  // QQ first: native per-track genre is authoritative for CJK (self-skips non-QQ tracks with
  // no network call), then the per-track/baseline text-match sources.
  const order: EnrichmentSource[] = ["qq"];
  if (settings.lastfmApiKey) order.push("lastfm");
  order.push("musicbrainz");
  if (settings.discogsToken) order.push("discogs");
  return order;
}

function buildProvider(
  source: EnrichmentSource,
  settings: AppSettings,
): MetadataEnrichmentProvider | null {
  switch (source) {
    case "lastfm":
      return settings.lastfmApiKey ? createLastfmProvider({ apiKey: settings.lastfmApiKey }) : null;
    case "discogs":
      return settings.discogsToken ? createDiscogsProvider({ token: settings.discogsToken }) : null;
    case "musicbrainz":
      return createMusicbrainzProvider();
    case "qq": {
      // Guest detail works (cookie optional). The provider self-skips non-QQ tracks, so it's
      // always constructed but only hits the network for QQ mids.
      const http = createStreamHttp();
      const cookie = settings.streamSources?.qq?.cookie;
      return createQqEnrichmentProvider({
        fetchNativeGenre: (mid, signal) => fetchQqNativeGenre(http, mid, cookie, signal),
      });
    }
    default:
      return null;
  }
}

/**
 * Composite provider: walk `providers` in order, returning the first non-null hit. A provider
 * that throws is skipped (network/server error ≠ authoritative miss) and the walk continues;
 * only if EVERY provider errored (and none matched) does it rethrow — so a genuine miss caches
 * as `notFound` but a transient outage doesn't poison the negative cache.
 */
export function createAutoEnrichmentProvider(
  providers: MetadataEnrichmentProvider[],
): MetadataEnrichmentProvider {
  return {
    // Representative id used only as the `notFound` fallback source (MusicBrainz = the baseline
    // that's always in the list). Real hits carry their own provider's source.
    id: "musicbrainz",
    label: "Auto",
    async fetch(q: EnrichmentQuery, signal?: AbortSignal): Promise<EnrichmentHit | null> {
      let lastError: unknown;
      let errored = 0;
      for (const provider of providers) {
        if (signal?.aborted) break;
        try {
          const hit = await provider.fetch(q, signal);
          if (hit) return hit;
        } catch (error) {
          lastError = error;
          errored += 1;
        }
      }
      // Every provider errored → surface it (real failure). Any clean miss → null (cacheable).
      if (errored > 0 && errored === providers.length) throw lastError;
      return null;
    },
  };
}

/** The enrichment provider for the current settings (an ordered auto composite). */
export function resolveEnrichmentProvider(settings: AppSettings): MetadataEnrichmentProvider {
  const providers = enrichmentProviderOrder(settings)
    .map((source) => buildProvider(source, settings))
    .filter((p): p is MetadataEnrichmentProvider => p !== null);
  return createAutoEnrichmentProvider(providers);
}
