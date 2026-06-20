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
  PlayableVideoTrack,
  StreamResolveOptions,
  StreamResolveResult,
  StreamSearchHit,
  StreamSearchOptions,
  StreamSourceProvider,
  StreamVideoResolveOptions,
  StreamVideoResolveResult,
  VideoQualityOption,
} from "../provider";
import { videoQualityLabel } from "../video-quality";
import { type BiliQualityKey, parseDashAudio, selectAudioByPreference } from "./bili-resolve";
import {
  type BiliVideoCodec,
  type BiliVideoStream,
  parseDashVideo,
  selectVideoByResolution,
} from "./bili-video";
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
// Richer DASH mask for VIDEO resolve: DASH + 4K + 8K + HDR + Dolby Vision + AV1 flags
// (4048 = 16+64+128+256+512+1024+2048, matching yt-dlp). Audio path keeps FNVAL_DASH.
const FNVAL_DASH_VIDEO = "4048";
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

  /** Fetch the DASH video tracks via the same signed playurl (richer fnval). */
  async function fetchVideoStreams(
    externalId: string,
    signal?: AbortSignal,
  ): Promise<BiliVideoStream[]> {
    const [bvid, cidHint] = externalId.split("#");
    const cid = cidHint ? Number(cidHint) : await fetchFirstCid(bvid, signal);
    if (!cid) return [];
    const url = await signedUrl(
      PLAYURL_URL,
      { bvid, cid: String(cid), fnval: FNVAL_DASH_VIDEO, fourk: "1" },
      signal,
    );
    const json = await getJson(url, signal);
    return parseDashVideo(json.data);
  }

  async function resolveVideo(
    externalId: string,
    opts?: StreamVideoResolveOptions,
  ): Promise<StreamVideoResolveResult> {
    try {
      const streams = await fetchVideoStreams(externalId, opts?.signal);
      if (!streams.length) return { kind: "error", message: "no video stream" };
      const pick = selectVideoByResolution(streams, { maxHeight: parseMaxHeight(opts?.quality) });
      if (!pick?.urls.length) return { kind: "error", message: "no video stream" };
      const video: PlayableVideoTrack = {
        url: pick.urls[0],
        headers: { Referer: REFERER, "User-Agent": USER_AGENT },
        mime: pick.mimeType ?? "video/mp4",
        codec: pick.codec,
        width: pick.width,
        height: pick.height,
        fps: pick.frameRate,
        bandwidth: pick.bandwidth,
        expiresAt: deadlineFromUrl(pick.urls[0]),
      };
      return { kind: "ok", video };
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async function listVideoQualities(
    externalId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<VideoQualityOption[]> {
    const streams = await fetchVideoStreams(externalId, opts?.signal);
    // One option per resolution; keep the most container-friendly codec (AVC-first) as
    // the representative. The actual codec is re-picked at resolveVideo time.
    const byHeight = new Map<number, BiliVideoStream>();
    for (const s of streams) {
      const h = s.height ?? 0;
      const cur = byHeight.get(h);
      if (!cur || codecPriority(s.codec) < codecPriority(cur.codec)) byHeight.set(h, s);
    }
    return [...byHeight.values()]
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
      .map((s) => ({
        key: String(s.height ?? 0),
        label: videoQualityLabel(s.height ?? 0, s.frameRate),
        height: s.height ?? 0,
        fps: s.frameRate,
        codec: s.codec,
        bandwidth: s.bandwidth,
      }));
  }

  return {
    id: "bili",
    label: "Bilibili",
    requiresLogin: false,
    isAuthed: () => Boolean(deps.getCookie?.()),
    search,
    resolve,
    resolveVideo,
    listVideoQualities,
  };
}

const VIDEO_CODEC_ORDER: BiliVideoCodec[] = ["avc", "hevc", "av1", "other"];

/** AVC-first ranking for the per-resolution representative (container-compat, not quality). */
function codecPriority(codec: BiliVideoCodec): number {
  const i = VIDEO_CODEC_ORDER.indexOf(codec);
  return i === -1 ? VIDEO_CODEC_ORDER.length : i;
}

/** Parse a quality key ("1080" / "max" / undefined) into a max-height cap. */
function parseMaxHeight(quality?: string): number | undefined {
  if (!quality || quality === "max") return undefined;
  const n = Number(quality);
  return Number.isFinite(n) && n > 0 ? n : undefined;
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
