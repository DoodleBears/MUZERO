/**
 * QQ Music native genre extraction — QQ's `get_song_detail_yqq` carries a human-readable
 * genre + language under `data.info.{genre,lan}` as `{ title, content:[{ value }] }` blocks
 * (E2E-verified: 稻香→Pop/国语, Yellow→Alternative/英语 — see the genre-enrichment PRD). The
 * app's stream parsers drop these; the enrichment QQ provider reads them here. Reuses the
 * exported QQ signing/URL (kept in this folder, not scattered into `enrich/`).
 */

import { type StreamHttp, withQuery } from "../http";
import { QQ_MUSICU_URL } from "./qq-resolve";
import { parseQqMusicKey, QQ_GUEST_GTK, qqGtk } from "./qq-sign";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REFERER = "https://y.qq.com";
const DETAIL_MODULE = "music.pf_song_detail_svr";
const DETAIL_METHOD = "get_song_detail_yqq";

export interface QqNativeGenre {
  /** Human-readable genres (raw, e.g. "Pop"/"Alternative") — normalize before use. */
  genres: string[];
  /** Song language, e.g. "国语"/"英语" (not a genre; kept for future faceting). */
  language?: string;
}

/** Strip an optional `callback(...)` JSONP wrapper (mirror of qq-source). */
function unwrapJsonp(text: string): string {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (text.startsWith("callback") && open > 0 && close > open) return text.slice(open + 1, close);
  return text;
}

function contentValues(block: unknown): string[] {
  const content = (block as { content?: { value?: unknown }[] } | undefined)?.content;
  return Array.isArray(content)
    ? content.map((c) => c?.value).filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
}

/** Pure: pull genre names + language from a `get_song_detail_yqq` payload. */
export function parseQqNativeGenre(json: unknown): QqNativeGenre {
  const j = json as { songinfo?: { data?: { info?: unknown } }; data?: { info?: unknown } } | null;
  const info = (j?.songinfo?.data?.info ?? j?.data?.info) as
    | { genre?: unknown; lan?: unknown }
    | undefined;
  return { genres: contentValues(info?.genre), language: contentValues(info?.lan)[0] };
}

/** Fetch QQ native genre by song mid (guest works; cookie optional). Null on network/parse error. */
export async function fetchQqNativeGenre(
  http: StreamHttp,
  mid: string,
  cookie?: string,
  signal?: AbortSignal,
): Promise<QqNativeGenre | null> {
  const musickey = parseQqMusicKey(cookie);
  const gtk = musickey ? qqGtk(musickey) : QQ_GUEST_GTK;
  const body = {
    songinfo: { module: DETAIL_MODULE, method: DETAIL_METHOD, param: { song_mid: mid } },
  };
  const url = withQuery(QQ_MUSICU_URL, {
    format: "json",
    g_tk: String(gtk),
    data: JSON.stringify(body),
  });
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Referer: REFERER };
  if (cookie) headers.Cookie = cookie;
  try {
    const res = await http({ url, method: "GET", headers, signal });
    return parseQqNativeGenre(JSON.parse(unwrapJsonp(await res.text())));
  } catch {
    return null;
  }
}
