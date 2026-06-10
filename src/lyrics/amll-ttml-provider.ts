/**
 * AMLL TTML Database provider — fetches Apple-Music-like word-by-word TTML lyrics
 * from the community database (amll-ttml-db, CC0-1.0). The DB is keyed by platform
 * song id, NOT text, so this is an EXACT source: it resolves only when the query
 * carries a NetEase song id (`neteaseSongId`, a streamed NetEase track's
 * `streamExternalId`). No fuzzy `search` — the manual text-search panel degrades to
 * "no results" for this provider (use LRCLIB / NetEase to search by title).
 *
 * Opt-in only (visible Settings dropdown, CLAUDE.md rule 3); it never becomes an
 * automatic endpoint unless the user picks it. All HTTP goes through `getAppFetch()`
 * (CORS-safe desktop bridge, rule 5/10). Attribution: see THIRD-PARTY-LICENSES.md.
 */

import { getAppFetch } from "@/lib/platform";
import { LyricsError, type LyricsHit, type LyricsProvider, type LyricsQuery } from "./provider";

const RAW_BASE = "https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main";
const DEFAULT_TIMEOUT_MS = 8000;

/** Direct raw URL of the TTML lyric for a NetEase Cloud Music song id. Pure. */
export function buildAmllNcmTtmlUrl(ncmId: string): string {
  return `${RAW_BASE}/ncm-lyrics/${encodeURIComponent(ncmId)}.ttml`;
}

/** Combine the caller's abort with a hard timeout so a stalled request always settles. */
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

export interface AmllProviderConfig {
  /** Injected fetch for tests; defaults to the CORS-safe getAppFetch. */
  fetchImpl?: typeof globalThis.fetch;
  /** Per-request timeout in ms. Default 8000. */
  timeoutMs?: number;
}

export function createAmllTtmlProvider(cfg: AmllProviderConfig = {}): LyricsProvider {
  const resolveFetch = async () => cfg.fetchImpl ?? (await getAppFetch());
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function fetchByNcmId(ncmId: string, signal?: AbortSignal): Promise<LyricsHit | null> {
    const fetchFn = await resolveFetch();
    const res = await fetchFn(buildAmllNcmTtmlUrl(ncmId), {
      signal: withTimeout(signal, timeoutMs),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new LyricsError(`AMLL ncm/${ncmId} failed (${res.status})`);
    const text = (await res.text()).trim();
    if (!text.includes("<tt")) return null; // not a TTML document
    return {
      source: "amll",
      sourceId: ncmId,
      synced: text,
      format: "ttml",
      instrumental: false,
      matched: { trackName: "", artistName: "", durationSec: 0 },
    };
  }

  return {
    id: "amll",
    label: "AMLL TTML DB",

    async fetch(q: LyricsQuery, signal?: AbortSignal): Promise<LyricsHit | null> {
      return q.neteaseSongId ? fetchByNcmId(q.neteaseSongId, signal) : null;
    },

    async getById(id: string, signal?: AbortSignal): Promise<LyricsHit | null> {
      return fetchByNcmId(id, signal);
    },

    async health(): Promise<boolean> {
      try {
        const fetchFn = await resolveFetch();
        const res = await fetchFn(buildAmllNcmTtmlUrl("0"), {
          signal: AbortSignal.timeout(timeoutMs),
        });
        return res.status < 500; // a 404 still means the host is reachable
      } catch {
        return false;
      }
    },
  };
}
