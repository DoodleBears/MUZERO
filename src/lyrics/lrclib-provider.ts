/**
 * LRCLIB provider — a thin shell over the pure mappings in `lrclib-map.ts`. All
 * HTTP goes through `getAppFetch()` (CORS-safe desktop bridge, CLAUDE.md rule
 * 5/10). Strategy: exact `/api/get` first (highest hit rate), fall back to
 * `/api/search` + client-side ranking. Returns null for "no match"; throws
 * `LyricsError` on network/server failures so the caller can distinguish.
 */

import { getAppFetch } from "@/lib/platform";
import { buildLyricsQueryPlan } from "./build-query";
import {
  attachMatch,
  buildGetByIdUrl,
  buildGetUrl,
  buildSearchUrl,
  LRCLIB_BASE_URL,
  parseHit,
  parseSearchResults,
  pickBestHit,
} from "./lrclib-map";
import { passesGate, scoreCandidate } from "./match-text";
import { LyricsError, type LyricsHit, type LyricsProvider, type LyricsQuery } from "./provider";

/**
 * Best-effort UA — LRCLIB encourages (but doesn't require) it. Browser fetch
 * drops forbidden headers; the desktop muzfetch/main process can set it.
 */
export const LRCLIB_USER_AGENT = "MUZERO (+https://mu0.app)";

/** Default per-request timeout — a hung network must never keep a request alive. */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Combine the caller's abort (track switch) with a hard timeout so a stalled
 * request always settles — it can't pin a connection (and on Electron, contend
 * with other muzfetch traffic) indefinitely.
 */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  // Fallback: mirror both inputs onto one controller.
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

export interface LrclibProviderConfig {
  /** Injected fetch for tests; defaults to the CORS-safe getAppFetch. */
  fetchImpl?: typeof globalThis.fetch;
  userAgent?: string;
  /** Per-request timeout in ms. Default 8000. */
  timeoutMs?: number;
}

export function createLrclibProvider(cfg: LrclibProviderConfig = {}): LyricsProvider {
  const resolveFetch = async () => cfg.fetchImpl ?? (await getAppFetch());
  const headers = { "user-agent": cfg.userAgent ?? LRCLIB_USER_AGENT };
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const init = (signal?: AbortSignal): RequestInit => ({
    headers,
    signal: withTimeout(signal, timeoutMs),
  });

  return {
    id: "lrclib",
    label: "LRCLIB",

    async fetch(q: LyricsQuery, signal?: AbortSignal): Promise<LyricsHit | null> {
      const fetchFn = await resolveFetch();
      // GET a URL → parsed JSON. 404 → null (no match, relax to the next rung);
      // any other non-2xx → throw so the caller distinguishes a miss from a failure.
      const getJson = async (url: string): Promise<unknown> => {
        const res = await fetchFn(url, init(signal));
        if (res.ok) return res.json().catch(() => null);
        if (res.status === 404) return null;
        throw new LyricsError(`LRCLIB ${new URL(url).pathname} failed (${res.status})`);
      };
      const plan = buildLyricsQueryPlan(q);

      // L0 — exact signature (raw title + full artist + album + duration). Highest hit rate, cheapest.
      const l0 = parseHit(await getJson(buildGetUrl(plan.primary)));
      if (l0 && passesGate(scoreCandidate(l0, q), "exact")) return attachMatch(l0, q, "exact");
      if (signal?.aborted) return null;

      // L1 — normalized title + primary artist (skip when normalization changed nothing).
      if (plan.normalizedDiffers) {
        const l1 = parseHit(await getJson(buildGetUrl(plan.normalized)));
        if (l1 && passesGate(scoreCandidate(l1, q), "norm")) return attachMatch(l1, q, "norm");
        if (signal?.aborted) return null;
      }

      // L2 — fuzzy search without album, client-ranked + gated.
      const l2 = pickBestHit(
        parseSearchResults(await getJson(buildSearchUrl(plan.normalized, { dropAlbum: true }))),
        q,
        "noAlbum",
      );
      if (l2) return attachMatch(l2, q, "noAlbum");
      if (signal?.aborted) return null;

      // L3 — title-only (artist dropped): widest recall, strongest gate (title-similarity floor).
      const l3 = pickBestHit(
        parseSearchResults(await getJson(buildSearchUrl(plan.normalized, { titleOnly: true }))),
        q,
        "titleOnly",
      );
      return l3 ? attachMatch(l3, q, "titleOnly") : null;
    },

    async search(q: LyricsQuery, signal?: AbortSignal): Promise<LyricsHit[]> {
      const fetchFn = await resolveFetch();
      const res = await fetchFn(buildSearchUrl(q), init(signal));
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new LyricsError(`LRCLIB /api/search failed (${res.status})`);
      }
      return parseSearchResults(await res.json().catch(() => null));
    },

    async getById(id: string, signal?: AbortSignal): Promise<LyricsHit | null> {
      const fetchFn = await resolveFetch();
      const res = await fetchFn(buildGetByIdUrl(id), init(signal));
      if (res.status === 404) return null;
      if (!res.ok) throw new LyricsError(`LRCLIB /api/get/${id} failed (${res.status})`);
      return parseHit(await res.json().catch(() => null));
    },

    async health(): Promise<boolean> {
      try {
        const fetchFn = await resolveFetch();
        const res = await fetchFn(`${LRCLIB_BASE_URL}/api/search?q=test`, init());
        return res.status < 500;
      } catch {
        return false;
      }
    },
  };
}
