/**
 * NetEase StreamSourceProvider — orchestrates the weapi/eapi crypto cores over an
 * injected {@link StreamHttp}. weapi (form `params`+`encSecKey`) drives search;
 * eapi (form `params`) drives the playback-URL fetch, parsed into a verdict.
 *
 * The random weapi key is injected (`randomSecretKey` in prod, fixed in tests) so
 * search requests are deterministic under test. The MUSIC_U cookie (when present)
 * rides on every request via the proxy-injected `Cookie` header.
 */

import { log } from "@/lib/logger";
import type { StreamHttp } from "../http";
import type {
  PlayableStream,
  StreamPlaylist,
  StreamResolveOptions,
  StreamResolveResult,
  StreamSearchHit,
  StreamSearchOptions,
  StreamSourceProvider,
} from "../provider";
import { eapiEncrypt } from "./netease-crypto";
import {
  neteaseSongToHit,
  parseNeteaseDailySongs,
  parseNeteasePlaylistMeta,
  parseNeteasePlaylistTrackIds,
  parseNeteaseRecommendedPlaylists,
  parseNeteaseSongDetailHits,
  parseNeteaseUserId,
  parseNeteaseUserPlaylists,
} from "./netease-playlists";
import {
  NETEASE_PLAYER_URL_PATH,
  type NeteaseQuality,
  neteasePlaybackBody,
  parseNeteasePlayback,
} from "./netease-resolve";

// eapi (not the web weapi) — the web cloudsearch endpoint gates anonymous requests
// with code 50000005; the eapi/pc endpoint doesn't, and it reuses the resolve crypto.
const SEARCH_URL = "https://interface.music.163.com/eapi/cloudsearch/pc";
const SEARCH_API_PATH = "/api/cloudsearch/pc";
const PLAYER_URL = "https://interface.music.163.com/eapi/song/enhance/player/url/v1";
// Library (logged-in): account → user playlists → playlist detail (trackIds) → song detail.
const ACCOUNT_URL = "https://interface.music.163.com/eapi/nuser/account/get";
const ACCOUNT_PATH = "/api/nuser/account/get";
const USER_PLAYLIST_URL = "https://interface.music.163.com/eapi/user/playlist";
const USER_PLAYLIST_PATH = "/api/user/playlist";
const PLAYLIST_DETAIL_URL = "https://interface.music.163.com/eapi/v6/playlist/detail";
const PLAYLIST_DETAIL_PATH = "/api/v6/playlist/detail";
const SONG_DETAIL_URL = "https://interface.music.163.com/eapi/v3/song/detail";
const SONG_DETAIL_PATH = "/api/v3/song/detail";
const SONG_DETAIL_CHUNK = 500;
// Online discover (no library write): daily-recommended songs + recommended playlists.
// eapi URL = .../eapi/<path without the /api/ prefix>, same as the lines above.
const DAILY_SONGS_URL = "https://interface.music.163.com/eapi/v3/discovery/recommend/songs";
const DAILY_SONGS_PATH = "/api/v3/discovery/recommend/songs";
const RECOMMEND_RESOURCE_URL =
  "https://interface.music.163.com/eapi/v1/discovery/recommend/resource";
const RECOMMEND_RESOURCE_PATH = "/api/v1/discovery/recommend/resource";
const PERSONALIZED_PLAYLIST_URL = "https://interface.music.163.com/eapi/personalized/playlist";
const PERSONALIZED_PLAYLIST_PATH = "/api/personalized/playlist";
const PERSONALIZED_PLAYLIST_LIMIT = "30";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REFERER = "https://music.163.com";

export interface NeteaseSourceDeps {
  http: StreamHttp;
  /** Current netease cookie (MUSIC_U…), or undefined when anonymous. */
  getCookie?: () => string | undefined;
}

function formBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export function createNeteaseSource(deps: NeteaseSourceDeps): StreamSourceProvider {
  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Referer: REFERER,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    // The eapi (mobile/client) endpoint only honors VIP when the request looks like a
    // real client — it needs os/appver cookies. A *web* login only sets MUSIC_U/__csrf,
    // so append them (NeriPlayer does the same via setPersistedCookies). Sent even when
    // anonymous; harmless for search.
    const cookie = deps.getCookie?.();
    h.Cookie = cookie ? `${cookie}; os=pc; appver=8.10.35` : "os=pc; appver=8.10.35";
    return h;
  }

  async function post(
    url: string,
    body: string,
    signal?: AbortSignal,
  ): Promise<{ status: number; text: string }> {
    const res = await deps.http({ url, method: "POST", headers: headers(), body, signal });
    return { status: res.status, text: await res.text() };
  }

  async function search(query: string, opts?: StreamSearchOptions): Promise<StreamSearchHit[]> {
    const payload = JSON.stringify({
      s: query,
      type: "1",
      limit: String(opts?.limit ?? 30),
      offset: "0",
      total: "true",
    });
    const { params } = eapiEncrypt(SEARCH_API_PATH, payload);
    const { status, text } = await post(SEARCH_URL, formBody({ params }), opts?.signal);
    let json: { result?: { songs?: unknown[] } };
    try {
      json = JSON.parse(text);
    } catch {
      // A non-JSON body (anti-bot HTML, redirect, empty) means no results.
      log.warn("netease", "search response is not JSON", { status, head: text.slice(0, 200) });
      return [];
    }
    return (json.result?.songs ?? []).map(neteaseSongToHit);
  }

  async function resolve(
    externalId: string,
    opts?: StreamResolveOptions,
  ): Promise<StreamResolveResult> {
    try {
      const level = (opts?.quality as NeteaseQuality) || "exhigh";
      const payload = JSON.stringify(neteasePlaybackBody(externalId, level));
      const { params } = eapiEncrypt(NETEASE_PLAYER_URL_PATH, payload);
      const { text } = await post(PLAYER_URL, formBody({ params }), opts?.signal);
      const verdict = parseNeteasePlayback(text);

      switch (verdict.kind) {
        case "success": {
          const stream: PlayableStream = {
            mediaUrl: verdict.url,
            headers: { "User-Agent": USER_AGENT, Referer: REFERER },
            mime: mimeFor(verdict.type),
            quality: level,
          };
          return { kind: "ok", stream };
        }
        case "requires-login":
          return { kind: "requires-login" };
        case "no-permission":
          return { kind: "no-permission", reason: verdict.reason };
        default:
          return { kind: "error", message: verdict.reason };
      }
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async function postEapiJson(
    url: string,
    apiPath: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const { params } = eapiEncrypt(apiPath, JSON.stringify(payload));
    const { text } = await post(url, formBody({ params }), signal);
    return JSON.parse(text);
  }

  async function getUserId(signal?: AbortSignal): Promise<string | null> {
    return parseNeteaseUserId(await postEapiJson(ACCOUNT_URL, ACCOUNT_PATH, {}, signal));
  }

  async function getUserPlaylists(opts?: { signal?: AbortSignal }): Promise<StreamPlaylist[]> {
    const uid = await getUserId(opts?.signal);
    if (!uid) return [];
    const json = await postEapiJson(
      USER_PLAYLIST_URL,
      USER_PLAYLIST_PATH,
      { uid, offset: "0", limit: "1000", includeVideo: "true" },
      opts?.signal,
    );
    return parseNeteaseUserPlaylists(json);
  }

  // song/detail is batched (a full playlist's trackIds can be thousands).
  async function songDetailHits(ids: string[], signal?: AbortSignal): Promise<StreamSearchHit[]> {
    const hits: StreamSearchHit[] = [];
    for (let i = 0; i < ids.length; i += SONG_DETAIL_CHUNK) {
      const chunk = ids.slice(i, i + SONG_DETAIL_CHUNK);
      const c = JSON.stringify(chunk.map((id) => ({ id: Number(id) })));
      const json = await postEapiJson(SONG_DETAIL_URL, SONG_DETAIL_PATH, { c }, signal);
      hits.push(...parseNeteaseSongDetailHits(json));
    }
    return hits;
  }

  /** Resolve specific song ids (from a pasted `…/song?id=` link) to hits. */
  async function getTracksByIds(
    ids: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<StreamSearchHit[]> {
    return songDetailHits(ids, opts?.signal);
  }

  async function getPlaylistMeta(
    playlistId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<StreamPlaylist | null> {
    const detail = await postEapiJson(
      PLAYLIST_DETAIL_URL,
      PLAYLIST_DETAIL_PATH,
      { id: playlistId, n: "0", s: "0" },
      opts?.signal,
    );
    return parseNeteasePlaylistMeta(detail);
  }

  async function importPlaylist(
    playlistId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<StreamSearchHit[]> {
    const detail = await postEapiJson(
      PLAYLIST_DETAIL_URL,
      PLAYLIST_DETAIL_PATH,
      { id: playlistId, n: "100000", s: "8" },
      opts?.signal,
    );
    return songDetailHits(parseNeteasePlaylistTrackIds(detail), opts?.signal);
  }

  /** 每日推荐歌曲 — needs login; `afresh` rerolls the 30. */
  async function getDailyRecommendedTracks(opts?: {
    signal?: AbortSignal;
    afresh?: boolean;
  }): Promise<StreamSearchHit[]> {
    const json = await postEapiJson(
      DAILY_SONGS_URL,
      DAILY_SONGS_PATH,
      opts?.afresh ? { afresh: "true" } : {},
      opts?.signal,
    );
    return parseNeteaseDailySongs(json);
  }

  /**
   * 推荐歌单 — anonymous `personalized/playlist` is the base (works logged-out); when
   * authed, the personalized "每日推荐歌单" (`recommend/resource`) is merged in front,
   * deduped by id. The resource leg degrades to [] on failure so the base still shows.
   */
  async function getRecommendedPlaylists(opts?: {
    signal?: AbortSignal;
  }): Promise<StreamPlaylist[]> {
    const personalized = parseNeteaseRecommendedPlaylists(
      await postEapiJson(
        PERSONALIZED_PLAYLIST_URL,
        PERSONALIZED_PLAYLIST_PATH,
        { limit: PERSONALIZED_PLAYLIST_LIMIT },
        opts?.signal,
      ),
    );
    if (!deps.getCookie?.()) return personalized;
    let daily: StreamPlaylist[] = [];
    try {
      daily = parseNeteaseRecommendedPlaylists(
        await postEapiJson(RECOMMEND_RESOURCE_URL, RECOMMEND_RESOURCE_PATH, {}, opts?.signal),
      );
    } catch (err) {
      log.warn("netease", "recommend/resource failed; using personalized only", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    const seen = new Set(daily.map((p) => p.id));
    return [...daily, ...personalized.filter((p) => !seen.has(p.id))];
  }

  return {
    id: "netease",
    label: "网易云音乐",
    requiresLogin: false,
    isAuthed: () => Boolean(deps.getCookie?.()),
    search,
    resolve,
    getUserPlaylists,
    getTracksByIds,
    getPlaylistMeta,
    importPlaylist,
    getDailyRecommendedTracks,
    getRecommendedPlaylists,
  };
}

function mimeFor(type: string | undefined): string {
  return type?.toLowerCase() === "flac" ? "audio/flac" : "audio/mpeg";
}
