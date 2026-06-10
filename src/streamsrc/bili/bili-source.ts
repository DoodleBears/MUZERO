/**
 * Bilibili StreamSourceProvider — orchestrates the pure cores (WBI signing, DASH
 * audio selection) over an injected {@link StreamHttp}. No direct bridge/network
 * dependency, so it's fully unit-testable with a stub transport.
 *
 * Flow: fetch + cache the WBI key pair from /nav → sign every request → search
 * videos → resolve a bvid to a DASH audio URL (view→cid→playurl). Playback URLs
 * need a `Referer: bilibili.com` header at GET time, returned on the PlayableStream
 * for the media proxy to inject.
 */

import type { StreamHttp } from "../http";
import { withQuery } from "../http";
import type {
  PlayableStream,
  StreamResolveOptions,
  StreamResolveResult,
  StreamSearchHit,
  StreamSearchOptions,
  StreamSourceProvider,
} from "../provider";
import { type BiliQualityKey, parseDashAudio, selectAudioByPreference } from "./bili-resolve";
import { deriveMixinKey, extractWbiKeyFromUrl, signWbi } from "./bili-wbi";

const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const SEARCH_URL = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const VIEW_URL = "https://api.bilibili.com/x/web-interface/wbi/view";
const PLAYURL_URL = "https://api.bilibili.com/x/player/wbi/playurl";
const REFERER = "https://www.bilibili.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// DASH (1<<4); fourk on. Audio tracks come back regardless of the video `qn`.
const FNVAL_DASH = "16";
const KEY_TTL_MS = 10 * 60 * 1000;

export interface BiliSourceDeps {
  http: StreamHttp;
  /** Wall clock (ms) — injected for deterministic `wts` + key-cache expiry. */
  now: () => number;
  /** Current bili cookie (SESSDATA…), or undefined when anonymous. */
  getCookie?: () => string | undefined;
}

interface CachedKeys {
  mixinKey: string;
  fetchedAt: number;
}

export function createBiliSource(deps: BiliSourceDeps): StreamSourceProvider {
  let keyCache: CachedKeys | null = null;

  function headers(): Record<string, string> {
    const h: Record<string, string> = { Referer: REFERER, "User-Agent": USER_AGENT };
    const cookie = deps.getCookie?.();
    if (cookie) h.Cookie = cookie;
    return h;
  }

  async function getJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const res = await deps.http({ url, method: "GET", headers: headers(), signal });
    return (await res.json()) as Record<string, unknown>;
  }

  async function ensureMixinKey(signal?: AbortSignal): Promise<string> {
    if (keyCache && deps.now() - keyCache.fetchedAt < KEY_TTL_MS) return keyCache.mixinKey;
    const nav = await getJson(NAV_URL, signal);
    const wbi = (nav.data as { wbi_img?: { img_url?: string; sub_url?: string } } | undefined)
      ?.wbi_img;
    const imgKey = extractWbiKeyFromUrl(wbi?.img_url ?? "");
    const subKey = extractWbiKeyFromUrl(wbi?.sub_url ?? "");
    const mixinKey = deriveMixinKey(imgKey, subKey);
    keyCache = { mixinKey, fetchedAt: deps.now() };
    return mixinKey;
  }

  async function signedUrl(
    base: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<string> {
    const mixinKey = await ensureMixinKey(signal);
    const signed = signWbi(params, mixinKey, Math.floor(deps.now() / 1000));
    return withQuery(base, signed.params);
  }

  async function search(query: string, opts?: StreamSearchOptions): Promise<StreamSearchHit[]> {
    const url = await signedUrl(
      SEARCH_URL,
      { keyword: query, search_type: "video", page: "1" },
      opts?.signal,
    );
    const json = await getJson(url, opts?.signal);
    const result = (json.data as { result?: unknown[] } | undefined)?.result ?? [];
    return result.slice(0, opts?.limit ?? 30).map(toHit);
  }

  async function resolve(
    externalId: string,
    opts?: StreamResolveOptions,
  ): Promise<StreamResolveResult> {
    try {
      const [bvid, cidHint] = externalId.split("#");
      const cid = cidHint ? Number(cidHint) : await fetchFirstCid(bvid, opts?.signal);
      if (!cid) return { kind: "error", message: "no cid for video" };

      const url = await signedUrl(
        PLAYURL_URL,
        { bvid, cid: String(cid), fnval: FNVAL_DASH, fourk: "1" },
        opts?.signal,
      );
      const json = await getJson(url, opts?.signal);
      const streams = parseDashAudio(json.data);
      const quality = (opts?.quality as BiliQualityKey) || "high";
      const pick = selectAudioByPreference(streams, quality);
      if (!pick?.urls.length) return { kind: "error", message: "no audio stream" };

      const stream: PlayableStream = {
        mediaUrl: pick.urls[0],
        headers: { Referer: REFERER, "User-Agent": USER_AGENT },
        mime: pick.mimeType ?? "audio/mp4",
        quality: pick.qualityTag,
        expiresAt: deadlineFromUrl(pick.urls[0]),
      };
      return { kind: "ok", stream };
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async function fetchFirstCid(bvid: string, signal?: AbortSignal): Promise<number | null> {
    const url = await signedUrl(VIEW_URL, { bvid }, signal);
    const json = await getJson(url, signal);
    const data = json.data as { cid?: number; pages?: Array<{ cid?: number }> } | undefined;
    return data?.cid ?? data?.pages?.[0]?.cid ?? null;
  }

  return {
    id: "bili",
    label: "Bilibili",
    requiresLogin: false,
    isAuthed: () => Boolean(deps.getCookie?.()),
    search,
    resolve,
  };
}

interface RawSearchItem {
  bvid?: string;
  title?: string;
  author?: string;
  duration?: string | number;
  pic?: string;
}

function toHit(raw: unknown): StreamSearchHit {
  const item = raw as RawSearchItem;
  return {
    source: "bili",
    externalId: item.bvid ?? "",
    title: stripEm(item.title ?? ""),
    artist: item.author,
    durationSec: parseDuration(item.duration),
    coverUrl: normalizeCover(item.pic),
  };
}

/** Bilibili wraps the matched keyword in `<em class="keyword">…</em>`. */
function stripEm(title: string): string {
  return title.replace(/<\/?em[^>]*>/g, "");
}

/** "mm:ss" / "hh:mm:ss" / seconds → seconds. */
function parseDuration(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value) return undefined;
  if (!value.includes(":")) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return value
    .split(":")
    .map((p) => Number(p))
    .reduce((acc, p) => acc * 60 + p, 0);
}

function normalizeCover(pic: string | undefined): string | undefined {
  if (!pic) return undefined;
  return pic.startsWith("//") ? `https:${pic}` : pic;
}

/** Bili CDN URLs carry a `deadline=<unix s>`; surface it so the player re-resolves in time. */
function deadlineFromUrl(url: string): number | undefined {
  const match = url.match(/[?&]deadline=(\d+)/);
  return match ? Number(match[1]) * 1000 : undefined;
}
