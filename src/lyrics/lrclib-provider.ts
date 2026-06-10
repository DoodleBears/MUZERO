/**
 * LRCLIB provider — a thin shell over the pure mappings in `lrclib-map.ts`. All
 * HTTP goes through `getAppFetch()` (CORS-safe desktop bridge, CLAUDE.md rule
 * 5/10). Strategy: exact `/api/get` first (highest hit rate), fall back to
 * `/api/search` + client-side ranking. Returns null for "no match"; throws
 * `LyricsError` on network/server failures so the caller can distinguish.
 */

import { getAppFetch } from "@/lib/platform";
import {
  buildGetUrl,
  buildSearchUrl,
  LRCLIB_BASE_URL,
  parseHit,
  parseSearchResults,
  pickBestHit,
} from "./lrclib-map";
import { LyricsError, type LyricsHit, type LyricsProvider, type LyricsQuery } from "./provider";

/**
 * Best-effort UA — LRCLIB encourages (but doesn't require) it. Browser fetch
 * drops forbidden headers; the desktop muzfetch/main process can set it.
 */
export const LRCLIB_USER_AGENT = "MUZERO (+https://mu0.app)";

export interface LrclibProviderConfig {
  /** Injected fetch for tests; defaults to the CORS-safe getAppFetch. */
  fetchImpl?: typeof globalThis.fetch;
  userAgent?: string;
}

export function createLrclibProvider(cfg: LrclibProviderConfig = {}): LyricsProvider {
  const resolveFetch = async () => cfg.fetchImpl ?? (await getAppFetch());
  const headers = { "user-agent": cfg.userAgent ?? LRCLIB_USER_AGENT };

  return {
    id: "lrclib",
    label: "LRCLIB",

    async fetch(q: LyricsQuery, signal?: AbortSignal): Promise<LyricsHit | null> {
      const fetchFn = await resolveFetch();

      // 1) Exact signature match.
      const getRes = await fetchFn(buildGetUrl(q), { headers, signal });
      if (getRes.ok) {
        const hit = parseHit(await getRes.json().catch(() => null));
        if (hit) return hit;
      } else if (getRes.status !== 404) {
        throw new LyricsError(`LRCLIB /api/get failed (${getRes.status})`);
      }

      // 2) Fuzzy search fallback, ranked by synced/duration.
      const searchRes = await fetchFn(buildSearchUrl(q), { headers, signal });
      if (!searchRes.ok) {
        if (searchRes.status === 404) return null;
        throw new LyricsError(`LRCLIB /api/search failed (${searchRes.status})`);
      }
      return pickBestHit(parseSearchResults(await searchRes.json().catch(() => null)), q);
    },

    async health(): Promise<boolean> {
      try {
        const fetchFn = await resolveFetch();
        const res = await fetchFn(`${LRCLIB_BASE_URL}/api/search?q=test`, { headers });
        return res.status < 500;
      } catch {
        return false;
      }
    },
  };
}
