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
  StreamResolveOptions,
  StreamResolveResult,
  StreamSearchHit,
  StreamSearchOptions,
  StreamSourceProvider,
} from "../provider";
import { eapiEncrypt } from "./netease-crypto";
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
    const cookie = deps.getCookie?.();
    if (cookie) h.Cookie = cookie;
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
    let json: { code?: number; msg?: string; message?: string; result?: { songs?: unknown[] } };
    try {
      json = JSON.parse(text);
    } catch {
      // Diagnostic: a non-JSON body (anti-bot HTML, redirect, empty) is the usual cause
      // of "no results". The head reveals which. Remove once the root cause is fixed.
      log.warn("netease", "search response is not JSON", { status, head: text.slice(0, 240) });
      return [];
    }
    const songs = json.result?.songs ?? [];
    log.info("netease", "search", {
      status,
      code: json.code,
      message: json.message ?? json.msg,
      count: songs.length,
    });
    return songs.map(toHit);
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

  return {
    id: "netease",
    label: "网易云音乐",
    requiresLogin: false,
    isAuthed: () => Boolean(deps.getCookie?.()),
    search,
    resolve,
  };
}

interface RawSong {
  id?: number;
  name?: string;
  ar?: Array<{ name?: string }>;
  artists?: Array<{ name?: string }>;
  al?: { name?: string; picUrl?: string };
  album?: { name?: string; picUrl?: string };
  dt?: number;
  duration?: number;
}

function toHit(raw: unknown): StreamSearchHit {
  const song = raw as RawSong;
  const artists = song.ar ?? song.artists ?? [];
  const album = song.al ?? song.album;
  const durationMs = song.dt ?? song.duration;
  return {
    source: "netease",
    externalId: String(song.id ?? ""),
    title: song.name ?? "",
    artist:
      artists
        .map((a) => a.name)
        .filter(Boolean)
        .join("/") || undefined,
    album: album?.name,
    durationSec: typeof durationMs === "number" ? Math.round(durationMs / 1000) : undefined,
    coverUrl: album?.picUrl,
  };
}

function mimeFor(type: string | undefined): string {
  return type?.toLowerCase() === "flac" ? "audio/flac" : "audio/mpeg";
}
