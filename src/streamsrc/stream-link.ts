/**
 * Recognize a pasted share link (NetEase song/playlist …) so the ⌘/Ctrl+F search
 * overlay can resolve it directly instead of treating it as a text query. Pure +
 * data-driven: it returns a source-agnostic `{source, kind, id}` ref; the caller
 * dispatches to the matching `StreamSourceProvider` (CLAUDE.md rule 5 — no `if
 * (source === …)` outside this resolution layer).
 *
 * Accepts a bare URL or a URL embedded in share text ("分享歌单《…》: <url> (来自…)").
 */

import type { StreamSourceId } from "@/db/types";
import { log } from "@/lib/logger";
import type { StreamHttp } from "./http";

export interface StreamLinkRef {
  source: StreamSourceId;
  kind: "song" | "playlist";
  id: string;
}

const URL_RE = /https?:\/\/[^\s<>"']+/i;

export function parseStreamLink(text: string): StreamLinkRef | null {
  const raw = text.match(URL_RE)?.[0];
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host.endsWith("music.163.com")) return parseNetease(url);
  if (host.endsWith("y.qq.com")) return parseQq(url);
  if (host.endsWith("bilibili.com")) return parseBili(url);
  if (host === "youtu.be" || host.endsWith("youtube.com")) return parseYoutube(url);
  return null;
}

const BV_RE = /^BV[0-9A-Za-z]{8,}$/;
const AV_RE = /^av\d+$/i;
// A YouTube video id is exactly 11 url-safe chars. Heuristic: a bare 11-char token is
// treated as a YT id (the user asked for raw-id input) — BV ids are 12 chars so they're
// checked first and never collide.
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Recognize a *bare* id the user typed directly — a Bilibili `BV…`/`av…` number or a
 * YouTube 11-char video id — so the ⌘F overlay resolves it targeted (via getTracksByIds)
 * instead of running a keyword search. Returns null for ordinary text queries.
 */
export function parseBareStreamId(text: string): StreamLinkRef | null {
  const q = text.trim();
  if (BV_RE.test(q) || AV_RE.test(q)) return { source: "bili", kind: "song", id: q };
  if (YT_ID_RE.test(q)) return { source: "youtube", kind: "song", id: q };
  return null;
}

function parseBili(url: URL): StreamLinkRef | null {
  // /video/BV…  (also matches with a trailing slash or query string; av… is legacy).
  const video = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i);
  if (video) return { source: "bili", kind: "song", id: video[1] };
  // 收藏夹: space.bilibili.com/<uid>/favlist?fid=<media_id> — fid IS the media_id.
  const fid = url.searchParams.get("fid");
  if (/\/favlist/i.test(url.pathname) && fid && /^\d+$/.test(fid)) {
    return { source: "bili", kind: "playlist", id: fid };
  }
  // 收藏夹分享: bilibili.com/medialist/detail/ml<media_id>.
  const ml = url.pathname.match(/\/medialist\/detail\/ml(\d+)/i);
  if (ml) return { source: "bili", kind: "playlist", id: ml[1] };
  return null;
}

function parseYoutube(url: URL): StreamLinkRef | null {
  if (url.hostname.toLowerCase() === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id ? { source: "youtube", kind: "song", id } : null;
  }
  const path = url.pathname.match(/\/(?:shorts|embed|v)\/([\w-]+)/);
  if (path) return { source: "youtube", kind: "song", id: path[1] };
  const v = url.searchParams.get("v");
  if (v) return { source: "youtube", kind: "song", id: v };
  const list = url.searchParams.get("list");
  if (list) return { source: "youtube", kind: "playlist", id: list };
  return null;
}

function parseNetease(url: URL): StreamLinkRef | null {
  const id = neteaseId(url);
  if (!id) return null;
  // Combine path + hash so both `/song?id=` and `#/song?id=` routing forms match.
  const hay = `${url.pathname}${url.hash}`.toLowerCase();
  if (hay.includes("playlist")) return { source: "netease", kind: "playlist", id };
  if (hay.includes("song")) return { source: "netease", kind: "song", id };
  return null;
}

function neteaseId(url: URL): string | null {
  const fromQuery = url.searchParams.get("id");
  if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;
  // Hash-routed links carry their own query string: `#/song?id=123`.
  const hashQuery = url.hash.split("?")[1];
  if (hashQuery) {
    const id = new URLSearchParams(hashQuery).get("id");
    if (id && /^\d+$/.test(id)) return id;
  }
  // Share text uses the `/song/{id}/` path form instead of `?id=`.
  const fromPath = `${url.pathname}${url.hash}`.match(/\/(?:song|playlist)\/(\d+)/);
  return fromPath ? fromPath[1] : null;
}

function parseQq(url: URL): StreamLinkRef | null {
  const hay = `${url.pathname}${url.hash}`;
  // Song mid is base62 (NOT purely numeric, unlike NetEase): /songDetail/<mid> or /song/<mid>.html.
  const song = hay.match(/\/song(?:detail)?\/([0-9A-Za-z]+)/i);
  if (song) return { source: "qq", kind: "song", id: song[1] };
  // Playlist disstid is numeric: /playlist/<disstid> or the mobile taoge.html?id=<disstid>.
  const playlist = hay.match(/\/playlist\/(\d+)/i);
  if (playlist) return { source: "qq", kind: "playlist", id: playlist[1] };
  if (/taoge/i.test(hay)) {
    const id = url.searchParams.get("id");
    if (id && /^\d+$/.test(id)) return { source: "qq", kind: "playlist", id };
  }
  return null;
}

/**
 * Detect a QQ Music *short* share link (the `c.y.qq.com` / `c6.y.qq.com`
 * `base/fcgi-bin/u?__=<token>` redirector) — it carries no disstid/mid, so it can't
 * be parsed directly and must be expanded via {@link expandStreamLink}. Returns the
 * bare URL to follow, or null when the text isn't such a short link.
 */
export function qqShortLinkUrl(text: string): string | null {
  const raw = text.match(URL_RE)?.[0];
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host.endsWith("y.qq.com") && /\/base\/fcgi-bin\/u$/i.test(url.pathname)) return raw;
  return null;
}

/**
 * Find the real QQ playlist/song reference inside a short link's page. QQ's
 * `base/fcgi-bin/u?__=…` shortener answers 200 with a client-side (JS/meta) redirect,
 * so the target lives in the HTML, not an HTTP `Location`. We scan for any embedded
 * QQ URL (un-escaping `\/`) and re-parse it; failing that, a bare `disstid`.
 */
export function scrapeQqLink(html: string): StreamLinkRef | null {
  // Allow backslashes inside the match so JS-escaped paths (`\/n2\/…`) aren't
  // truncated at the first `\/`; they're stripped before parsing.
  for (const match of html.matchAll(/https?:(?:\\?\/){2}[^\s"'<>]+/gi)) {
    const candidate = match[0].replace(/\\/g, "");
    if (!/qq\.com/i.test(candidate)) continue;
    const ref = parseStreamLink(candidate);
    if (ref) return ref;
  }
  const diss = html.match(/["']?disstid["']?\s*[:=]\s*["']?(\d{5,})/i);
  if (diss) return { source: "qq", kind: "playlist", id: diss[1] };
  return null;
}

/**
 * Resolve a QQ short link by fetching it (via the injected proxy, which follows any
 * server redirect) and scraping the resulting page for the real playlist/song link.
 * Async + impure (one network hop); the pure parser stays the link-shape source of
 * truth. Returns null (and logs a body head) when nothing parseable is found.
 */
export async function expandStreamLink(
  text: string,
  http: StreamHttp,
  opts?: { signal?: AbortSignal },
): Promise<StreamLinkRef | null> {
  const shortUrl = qqShortLinkUrl(text);
  if (!shortUrl) return null;
  const res = await http({
    url: shortUrl,
    method: "GET",
    headers: { Referer: "https://y.qq.com" },
    signal: opts?.signal,
  });
  const html = await res.text();
  const ref = scrapeQqLink(html);
  if (!ref) {
    // No QQ link/disstid in the page — likely a JS-only SPA shell or a new shape.
    log.warn("streamlink", "short link body had no parseable qq link", {
      status: res.status,
      head: html.slice(0, 400),
    });
  }
  return ref;
}
