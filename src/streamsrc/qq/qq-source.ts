/**
 * QQ Music StreamSourceProvider — guest-first. Search posts the modern musicu
 * `music.search.SearchCgiService` (the old GET `client_search_cp` 500s on current
 * servers); resolve asks musicu GetVkey for a batch of PLAINTEXT candidate filenames and picks
 * the best with a non-empty purl. No dynamic signing on the guest path (uin=0, guid,
 * g_tk=5381); a stored qqmusic_key cookie (login) switches g_tk to hash33(musickey)
 * and rides on every request. Encrypted tiers are never requested (PRD red line) —
 * an all-empty purl result is reported as no-permission.
 *
 * Everything QQ-specific (signing, quality codes, vkey parsing, song mapping) lives
 * in sibling pure modules; this file only wires them over the injected StreamHttp.
 */

import { log } from "@/lib/logger";
import { type StreamHttp, withQuery } from "../http";
import type {
  PlayableStream,
  StreamPlaylist,
  StreamResolveOptions,
  StreamResolveResult,
  StreamSearchHit,
  StreamSearchOptions,
  StreamSourceProvider,
} from "../provider";
import {
  parseQqMusicuSearch,
  parseQqPlaylistMeta,
  parseQqPlaylistTracks,
  parseQqSongDetail,
  parseQqUserPlaylists,
} from "./qq-playlists";
import { qqFilename, qqQualityCandidates } from "./qq-quality";
import { parseQqVkey, QQ_MUSICU_URL, qqStreamUrl, qqVkeyRequestBody } from "./qq-resolve";
import { parseQqMusicKey, parseQqUin, QQ_GUEST_GTK, qqCookieNames, qqGtk } from "./qq-sign";

/** The logged-in user's own created playlists (needs qqmusic_uin + g_tk). */
const USER_DISS_URL = "https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss";
// Modern unified search — the old GET `client_search_cp` 500s on current servers;
// every live QQ client now posts this musicu module (luren-dc verified).
const QQ_SEARCH_MODULE = "music.search.SearchCgiService";
const QQ_SEARCH_METHOD = "DoSearchForQQMusicDesktop";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REFERER = "https://y.qq.com";
/** NeriPlayer-Desktop guest device id; uin 0 = anonymous. */
const GUEST_GUID = "10000";
const GUEST_UIN = "0";
// Song detail — the endpoint NeriPlayer verified (get_song_detail_yqq).
const QQ_DETAIL_MODULE = "music.pf_song_detail_svr";
const QQ_DETAIL_METHOD = "get_song_detail_yqq";
// Playlist (歌单) detail — modern aiDissInfo (meta + songlist). Module/method are
// runtime-verifiable (PRD Phase 4); the tolerant parsers absorb shape drift.
const QQ_DISS_MODULE = "music.srfDissInfo.aiDissInfo";
const QQ_DISS_METHOD = "uniform_get_Dissinfo";
const QQ_DISS_IMPORT_SONGS = 1000;

export interface QqSourceDeps {
  http: StreamHttp;
  /** Current qq cookie (qqmusic_uin/qqmusic_key…), or undefined when anonymous. */
  getCookie?: () => string | undefined;
  /** Guest device id; defaults to the NeriPlayer-Desktop value. */
  guid?: string;
}

/** Strip an optional `callback(...)` JSONP wrapper QQ sometimes returns. */
function unwrapJsonp(text: string): string {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (text.startsWith("callback") && open > 0 && close > open) {
    return text.slice(open + 1, close);
  }
  return text;
}

export function createQqSource(deps: QqSourceDeps): StreamSourceProvider {
  const guid = deps.guid ?? GUEST_GUID;

  function gtk(): number {
    const musickey = parseQqMusicKey(deps.getCookie?.());
    return musickey ? qqGtk(musickey) : QQ_GUEST_GTK;
  }

  function headers(): Record<string, string> {
    const h: Record<string, string> = { "User-Agent": USER_AGENT, Referer: REFERER };
    const cookie = deps.getCookie?.();
    if (cookie) h.Cookie = cookie;
    return h;
  }

  async function get(url: string, signal?: AbortSignal): Promise<string> {
    const res = await deps.http({ url, method: "GET", headers: headers(), signal });
    return res.text();
  }

  async function search(query: string, opts?: StreamSearchOptions): Promise<StreamSearchHit[]> {
    const body = {
      music_search: {
        module: QQ_SEARCH_MODULE,
        method: QQ_SEARCH_METHOD,
        param: {
          query,
          search_type: 0,
          num_per_page: opts?.limit ?? 20,
          page_num: 1,
          grp: 1,
        },
      },
    };
    const url = withQuery(QQ_MUSICU_URL, {
      format: "json",
      g_tk: String(gtk()),
      data: JSON.stringify(body),
    });
    const resp = await deps.http({ url, method: "GET", headers: headers(), signal: opts?.signal });
    const text = await resp.text();
    try {
      return parseQqMusicuSearch(JSON.parse(unwrapJsonp(text)));
    } catch {
      log.warn("qq", "search response is not JSON", {
        status: resp.status,
        head: text.slice(0, 200),
      });
      return [];
    }
  }

  async function resolve(
    externalId: string,
    opts?: StreamResolveOptions,
  ): Promise<StreamResolveResult> {
    try {
      const cookie = deps.getCookie?.();
      const candidates = qqQualityCandidates(opts?.quality);
      const filenames = candidates.map((t) => qqFilename(t, externalId));
      const body = qqVkeyRequestBody(filenames, {
        guid,
        songmid: externalId,
        uin: parseQqUin(cookie) ?? GUEST_UIN,
        musickey: parseQqMusicKey(cookie),
      });
      const url = withQuery(QQ_MUSICU_URL, {
        format: "json",
        g_tk: String(gtk()),
        data: JSON.stringify(body),
      });
      const data = parseQqVkey(await get(url, opts?.signal));
      if (!data) return { kind: "error", message: "invalid-vkey-response" };
      for (let i = 0; i < candidates.length; i++) {
        const entry = data.entries.find((e) => e.filename === filenames[i] && e.purl);
        if (!entry) continue;
        const stream: PlayableStream = {
          mediaUrl: qqStreamUrl(data.sip, entry.purl),
          headers: { "User-Agent": USER_AGENT, Referer: REFERER },
          mime: candidates[i].mime,
          quality: candidates[i].key,
        };
        return { kind: "ok", stream };
      }
      // No plaintext purl across any candidate = VIP / encrypted-only / removed.
      // Log the per-filename purl-empty map so a runtime "no-permission" can be told
      // apart from a shape drift (entries present but filenames mismatched).
      log.warn("qq", "resolve found no plaintext purl", {
        authed: Boolean(cookie),
        sipCount: data.sip.length,
        entries: data.entries.map((e) => ({ filename: e.filename, hasPurl: Boolean(e.purl) })),
      });
      return { kind: "no-permission", reason: "vip-or-encrypted" };
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async function postMusicu(body: unknown, signal?: AbortSignal): Promise<unknown> {
    const url = withQuery(QQ_MUSICU_URL, {
      format: "json",
      g_tk: String(gtk()),
      data: JSON.stringify(body),
    });
    return JSON.parse(unwrapJsonp(await get(url, signal)));
  }

  /** Resolve song mids (from a pasted song link) to hits via the verified detail endpoint. */
  async function getTracksByIds(
    ids: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<StreamSearchHit[]> {
    const hits: StreamSearchHit[] = [];
    for (const mid of ids) {
      const json = await postMusicu(
        {
          songinfo: {
            module: QQ_DETAIL_MODULE,
            method: QQ_DETAIL_METHOD,
            param: { song_mid: mid },
          },
        },
        opts?.signal,
      );
      const hit = parseQqSongDetail(json);
      if (hit) hits.push(hit);
    }
    return hits;
  }

  async function fetchDiss(
    disstid: string,
    songNum: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return postMusicu(
      {
        req_0: {
          module: QQ_DISS_MODULE,
          method: QQ_DISS_METHOD,
          param: { disstid: Number(disstid), dirid: 0, song_num: songNum, song_begin: 0, tag: 1 },
        },
      },
      signal,
    );
  }

  /** The logged-in user's created playlists ("我的歌单"); [] when anonymous. */
  async function getUserPlaylists(opts?: { signal?: AbortSignal }): Promise<StreamPlaylist[]> {
    const cookie = deps.getCookie?.();
    const uin = parseQqUin(cookie);
    if (!uin) {
      // Login captured a cookie but no recognizable uin — log the names (not values)
      // so we can see which cookie actually holds it (y.qq.com naming varies).
      log.warn("qq", "getUserPlaylists: no uin in cookie", {
        authed: Boolean(cookie),
        cookieNames: qqCookieNames(cookie),
      });
      return [];
    }
    const url = withQuery(USER_DISS_URL, {
      hostuin: uin,
      sin: "0",
      size: "200",
      g_tk: String(gtk()),
      format: "json",
      inCharset: "utf8",
      outCharset: "utf-8",
      notice: "0",
      platform: "yqq.json",
      needNewCode: "0",
    });
    try {
      const lists = parseQqUserPlaylists(JSON.parse(unwrapJsonp(await get(url, opts?.signal))));
      log.info("qq", "getUserPlaylists", { count: lists.length });
      return lists;
    } catch {
      log.warn("qq", "user playlists response is not JSON");
      return [];
    }
  }

  /** A pasted playlist link's meta (name/cover/count) for the import card. */
  async function getPlaylistMeta(
    disstid: string,
    opts?: { signal?: AbortSignal },
  ): Promise<StreamPlaylist | null> {
    return parseQqPlaylistMeta(await fetchDiss(disstid, 0, opts?.signal));
  }

  /** Import a public playlist (disstid) → its songs as hits. */
  async function importPlaylist(
    disstid: string,
    opts?: { signal?: AbortSignal },
  ): Promise<StreamSearchHit[]> {
    return parseQqPlaylistTracks(await fetchDiss(disstid, QQ_DISS_IMPORT_SONGS, opts?.signal));
  }

  return {
    id: "qq",
    label: "QQ 音乐",
    requiresLogin: false,
    isAuthed: () => Boolean(deps.getCookie?.()),
    search,
    resolve,
    getUserPlaylists,
    getTracksByIds,
    getPlaylistMeta,
    importPlaylist,
  };
}
