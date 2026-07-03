/**
 * Discogs enrichment provider — BYOK (`token` from settings, device-local, never logged;
 * rule 2). One `/database/search` gives the curated genre + style taxonomy off the top
 * release. HTTP via `getAppFetch()` (Discogs needs no CORS but the desktop bridge keeps the
 * token off the renderer origin). Pure shape logic in `discogs-map.ts`.
 */

import { getAppFetch } from "@/lib/platform";
import {
  buildDiscogsSearchUrl,
  DISCOGS_BASE_URL,
  parseDiscogsSearch,
  toDiscogsHit,
} from "./discogs-map";
import {
  EnrichmentError,
  type EnrichmentHit,
  type EnrichmentQuery,
  type MetadataEnrichmentProvider,
} from "./provider";

/** Discogs requires a descriptive User-Agent per their API terms. */
export const DISCOGS_USER_AGENT = "MUZERO/1.0 +https://mu0.app";
const DEFAULT_TIMEOUT_MS = 8000;

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

export interface DiscogsProviderConfig {
  /** BYOK Discogs personal-access token (settings row). */
  token: string;
  fetchImpl?: typeof globalThis.fetch;
  userAgent?: string;
  timeoutMs?: number;
}

export function createDiscogsProvider(cfg: DiscogsProviderConfig): MetadataEnrichmentProvider {
  const resolveFetch = async () => cfg.fetchImpl ?? (await getAppFetch());
  const headers = { "user-agent": cfg.userAgent ?? DISCOGS_USER_AGENT };
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    id: "discogs",
    label: "Discogs",

    async fetch(q: EnrichmentQuery, signal?: AbortSignal): Promise<EnrichmentHit | null> {
      const fetchFn = await resolveFetch();
      const res = await fetchFn(buildDiscogsSearchUrl(q, cfg.token), {
        headers,
        signal: withTimeout(signal, timeoutMs),
      });
      if (!res.ok) throw new EnrichmentError(`Discogs search failed (${res.status})`);
      return toDiscogsHit(parseDiscogsSearch(await res.json().catch(() => null)));
    },

    async health(): Promise<boolean> {
      try {
        const fetchFn = await resolveFetch();
        const res = await fetchFn(
          `${DISCOGS_BASE_URL}/database/search?q=test&token=${encodeURIComponent(cfg.token)}`,
          {
            headers,
            signal: withTimeout(undefined, timeoutMs),
          },
        );
        return res.status < 500;
      } catch {
        return false;
      }
    },
  };
}
