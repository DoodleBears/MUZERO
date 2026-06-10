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
