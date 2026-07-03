/**
 * MusicBrainz enrichment provider — keyless, CORS-friendly, the v1 baseline. Walks a
 * recording→artist genre ladder: try the precise per-track recording genres first, fall
 * back to the dense per-artist genres when the recording is bare (E2E: Chinese recordings
 * are almost always bare, but the artist carries mandopop/中国风/…). All HTTP goes through
 * `getAppFetch()` (CORS-safe desktop bridge, rule 5/10); pure shape logic lives in
 * `musicbrainz-map.ts`. Returns null for "no match"; throws `EnrichmentError` on failures.
 *
 * MusicBrainz asks for ≤1 req/s + a descriptive User-Agent — the provider spaces its
 * sequential requests by `intervalMs` (injectable; tests pass 0) and sends a UA the muzfetch
 * main process restores (browser fetch forbids setting it).
 */

import { getAppFetch } from "@/lib/platform";
import {
  ARTIST_MATCH_CONFIDENCE,
  buildArtistLookupUrl,
  buildArtistSearchUrl,
  buildRecordingLookupUrl,
  buildRecordingSearchUrl,
  MUSICBRAINZ_BASE_URL,
  parseArtistLookup,
  parseArtistSearch,
  parseRecordingLookup,
  parseRecordingSearch,
  scoreToConfidence,
  toMusicbrainzHit,
} from "./musicbrainz-map";
import {
  EnrichmentError,
  type EnrichmentHit,
  type EnrichmentQuery,
  type MetadataEnrichmentProvider,
} from "./provider";

/** MusicBrainz requires a descriptive UA with contact — theirs blocks generic/empty ones. */
export const MUSICBRAINZ_USER_AGENT = "MUZERO/1.0 ( https://mu0.app )";

const DEFAULT_TIMEOUT_MS = 8000;
/** ≤1 req/s: space the ladder's sequential requests. */
const DEFAULT_INTERVAL_MS = 1100;

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

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface MusicbrainzProviderConfig {
  /** Injected fetch for tests; defaults to the CORS-safe getAppFetch. */
  fetchImpl?: typeof globalThis.fetch;
  userAgent?: string;
  timeoutMs?: number;
  /** Inter-request spacing (rate limit). Tests pass 0. */
  intervalMs?: number;
  /** Injected delay for deterministic tests; defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export function createMusicbrainzProvider(
  cfg: MusicbrainzProviderConfig = {},
): MetadataEnrichmentProvider {
  const resolveFetch = async () => cfg.fetchImpl ?? (await getAppFetch());
  const headers = { "user-agent": cfg.userAgent ?? MUSICBRAINZ_USER_AGENT };
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = cfg.intervalMs ?? DEFAULT_INTERVAL_MS;
  const sleep = cfg.sleep ?? realSleep;

  return {
    id: "musicbrainz",
    label: "MusicBrainz",

    async fetch(q: EnrichmentQuery, signal?: AbortSignal): Promise<EnrichmentHit | null> {
      const fetchFn = await resolveFetch();
      // GET → parsed JSON. 404 → null (no match); other non-2xx → throw (miss vs failure).
      const getJson = async (url: string): Promise<unknown> => {
        const res = await fetchFn(url, { headers, signal: withTimeout(signal, timeoutMs) });
        if (res.ok) return res.json().catch(() => null);
        if (res.status === 404) return null;
        throw new EnrichmentError(`MusicBrainz ${new URL(url).pathname} failed (${res.status})`);
      };
      const aborted = () => signal?.aborted === true;

      // Resolve the recording MBID: from ID3, else a recording search.
      let recordingMbid = q.musicBrainzRecordingId;
      let artistMbid: string | undefined;
      let recordingScore = 100;
      if (!recordingMbid) {
        const match = parseRecordingSearch(
          await getJson(buildRecordingSearchUrl(q.artistName, q.trackName)),
        );
        if (match) {
          recordingMbid = match.mbid;
          artistMbid = match.artistMbid;
          recordingScore = match.score;
        }
        if (aborted()) return null;
      }

      // L0 — per-track recording genres (precise). Empty for most Chinese recordings.
      if (recordingMbid) {
        await sleep(intervalMs);
        if (aborted()) return null;
        const rec = parseRecordingLookup(await getJson(buildRecordingLookupUrl(recordingMbid)));
        artistMbid = artistMbid ?? rec.artistMbid;
        const hit = toMusicbrainzHit(
          rec.rawTags,
          "recording",
          scoreToConfidence(recordingScore),
          recordingMbid,
        );
        if (hit) return hit;
        if (aborted()) return null;
      }

      // L1 — per-artist genres (coarse but dense; covers CJK). Resolve the artist MBID by
      // name when the recording search didn't embed it (or matched nothing).
      if (!artistMbid) {
        await sleep(intervalMs);
        if (aborted()) return null;
        artistMbid = parseArtistSearch(await getJson(buildArtistSearchUrl(q.artistName)));
        if (aborted()) return null;
      }
      if (artistMbid) {
        await sleep(intervalMs);
        if (aborted()) return null;
        const rawTags = parseArtistLookup(await getJson(buildArtistLookupUrl(artistMbid)));
        const hit = toMusicbrainzHit(rawTags, "artist", ARTIST_MATCH_CONFIDENCE, artistMbid);
        if (hit) return hit;
      }

      return null;
    },

    async health(): Promise<boolean> {
      try {
        const fetchFn = await resolveFetch();
        const res = await fetchFn(`${MUSICBRAINZ_BASE_URL}/recording?query=test&fmt=json&limit=1`, {
          headers,
          signal: withTimeout(undefined, timeoutMs),
        });
        return res.status < 500;
      } catch {
        return false;
      }
    },
  };
}
