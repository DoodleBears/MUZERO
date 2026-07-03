/**
 * Last.fm enrichment provider — BYOK (`api_key` from settings, device-local, never logged;
 * rule 2). `track.getTopTags` gives the densest per-track folksonomy tags for Western music.
 * All HTTP through `getAppFetch()` (CORS-safe desktop bridge; Last.fm sends no permissive
 * CORS headers → desktop-only, web degrades to MusicBrainz). Pure shape logic in `lastfm-map.ts`.
 *
 * Returns null for "no match" (Last.fm error 6 or all-noise tags); throws `EnrichmentError`
 * on auth/param errors + non-2xx so a real failure isn't cached as a permanent miss.
 */

import { getAppFetch } from "@/lib/platform";
import { buildTopTagsUrl, LASTFM_BASE_URL, parseTopTags, toLastfmHit } from "./lastfm-map";
import {
  EnrichmentError,
  type EnrichmentHit,
  type EnrichmentQuery,
  type MetadataEnrichmentProvider,
} from "./provider";

/** Best-effort UA; browser fetch drops it, the desktop muzfetch/main process sets it. */
export const LASTFM_USER_AGENT = "MUZERO/1.0 ( https://mu0.app )";
const DEFAULT_TIMEOUT_MS = 8000;
/** Last.fm error code for "the track wasn't found" — a miss, not a failure. */
const LASTFM_NOT_FOUND = 6;

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

export interface LastfmProviderConfig {
  /** BYOK Last.fm application api_key (settings row). */
  apiKey: string;
  fetchImpl?: typeof globalThis.fetch;
  userAgent?: string;
  timeoutMs?: number;
}

export function createLastfmProvider(cfg: LastfmProviderConfig): MetadataEnrichmentProvider {
  const resolveFetch = async () => cfg.fetchImpl ?? (await getAppFetch());
  const headers = { "user-agent": cfg.userAgent ?? LASTFM_USER_AGENT };
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    id: "lastfm",
    label: "Last.fm",

    async fetch(q: EnrichmentQuery, signal?: AbortSignal): Promise<EnrichmentHit | null> {
      const fetchFn = await resolveFetch();
      const res = await fetchFn(buildTopTagsUrl(q, cfg.apiKey), {
        headers,
        signal: withTimeout(signal, timeoutMs),
      });
      if (!res.ok) throw new EnrichmentError(`Last.fm getTopTags failed (${res.status})`);
      const parsed = parseTopTags(await res.json().catch(() => null));
      if (parsed.error != null) {
        if (parsed.error === LASTFM_NOT_FOUND) return null; // no match → negative cache
        throw new EnrichmentError(`Last.fm error ${parsed.error}`); // bad key/param → not a miss
      }
      return toLastfmHit(parsed.rawTags);
    },

    async health(): Promise<boolean> {
      try {
        const fetchFn = await resolveFetch();
        const res = await fetchFn(
          `${LASTFM_BASE_URL}?method=auth.gettoken&api_key=${encodeURIComponent(cfg.apiKey)}&format=json`,
          { headers, signal: withTimeout(undefined, timeoutMs) },
        );
        return res.status < 500;
      } catch {
        return false;
      }
    },
  };
}
