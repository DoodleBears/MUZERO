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
  if (url.hostname.toLowerCase().endsWith("music.163.com")) return parseNetease(url);
  if (url.hostname.toLowerCase().endsWith("y.qq.com")) return parseQq(url);
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
