/**
 * NetEase lyrics provider — a `LyricsProvider` backed by NetEase's eapi
 * `/song/lyric/v1`. The high-value path is exact: when the query carries a
 * `neteaseSongId` (a streamed NetEase track's `streamExternalId`) it fetches the
 * official lyrics directly, no search. Otherwise it reuses the tested NetEase
 * stream source's cloudsearch to find a songId by title/artist, then fetches.
 *
 * NetEase's lyric body is LRC text → returned as-is in `synced` (parsed by the
 * shared `parseLrc`). All HTTP goes through the injected {@link StreamHttp}
 * (muzfetch proxy: Cookie/Referer/UA injection + CORS), so it's desktop-grade and
 * unit-testable with a stub.
 */

import type { StreamHttp } from "@/streamsrc/http";
import { eapiEncrypt } from "@/streamsrc/netease/netease-crypto";
import { createNeteaseSource } from "@/streamsrc/netease/netease-source";
import { createStreamHttp } from "@/streamsrc/stream-http";
import {
  buildLyricBody,
  NETEASE_LYRIC_PATH,
  NETEASE_LYRIC_URL,
  parseNeteaseLyric,
  pickClosestByDuration,
} from "./netease-lyric-map";
import type { LyricsHit, LyricsProvider, LyricsQuery } from "./provider";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REFERER = "https://music.163.com";
const SEARCH_LIMIT = 8;
const SEARCH_RESULTS = 5;

export interface NeteaseLyricsDeps {
  /** Injected HTTP (muzfetch proxy in prod, stub in tests). Defaults to the real one. */
  http?: StreamHttp;
  /** Current NetEase cookie (MUSIC_U…) — optional; the lyric endpoint is public. */
  getCookie?: () => string | undefined;
}

function formBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export function createNeteaseLyricsProvider(deps: NeteaseLyricsDeps = {}): LyricsProvider {
  const http = deps.http ?? createStreamHttp();
  // Reuse the tested source for the title/artist → songId fallback search.
  const source = createNeteaseSource({ http, getCookie: deps.getCookie });

  function headers(): Record<string, string> {
    const cookie = deps.getCookie?.();
    return {
      "User-Agent": USER_AGENT,
      Referer: REFERER,
      "Content-Type": "application/x-www-form-urlencoded",
      // os/appver mark the request as a real client (dodges the eapi anti-crawler).
      Cookie: cookie ? `${cookie}; os=pc; appver=8.10.35` : "os=pc; appver=8.10.35",
    };
  }

  async function lyricById(songId: string, signal?: AbortSignal): Promise<LyricsHit | null> {
    const { params } = eapiEncrypt(NETEASE_LYRIC_PATH, JSON.stringify(buildLyricBody(songId)));
    const res = await http({
      url: NETEASE_LYRIC_URL,
      method: "POST",
      headers: headers(),
      body: formBody({ params }),
      signal,
    });
    let json: unknown;
    try {
      json = JSON.parse(await res.text());
    } catch {
      return null;
    }
    const parsed = parseNeteaseLyric(json);
    if (!parsed) return null;
    return {
      source: "netease",
      sourceId: songId,
      synced: parsed.synced,
      plain: parsed.plain,
      instrumental: parsed.instrumental,
      matched: { trackName: "", artistName: "", durationSec: 0 },
    };
  }

  async function searchSongs(q: LyricsQuery, signal?: AbortSignal) {
    const query = [q.trackName, q.artistName].filter(Boolean).join(" ").trim();
    if (!query) return [];
    return source.search(query, { limit: SEARCH_LIMIT, signal });
  }

  return {
    id: "netease",
    label: "网易云音乐",

    async fetch(q: LyricsQuery, signal?: AbortSignal): Promise<LyricsHit | null> {
      if (q.neteaseSongId) return lyricById(q.neteaseSongId, signal);
      const best = pickClosestByDuration(await searchSongs(q, signal), q.durationSec);
      return best ? lyricById(best.externalId, signal) : null;
    },

    async search(q: LyricsQuery, signal?: AbortSignal): Promise<LyricsHit[]> {
      const hits = await searchSongs(q, signal);
      const out: LyricsHit[] = [];
      for (const song of hits.slice(0, SEARCH_RESULTS)) {
        const lyric = await lyricById(song.externalId, signal);
        if (lyric?.synced || lyric?.plain || lyric?.instrumental) {
          out.push({
            ...lyric,
            sourceId: song.externalId,
            matched: {
              trackName: song.title,
              artistName: song.artist ?? "",
              durationSec: song.durationSec ?? 0,
            },
          });
        }
      }
      return out;
    },

    async getById(id: string, signal?: AbortSignal): Promise<LyricsHit | null> {
      return lyricById(id, signal);
    },
  };
}
