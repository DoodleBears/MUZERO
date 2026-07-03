/**
 * Dev-only enrichment feasibility probe (PRD desktop/20260704-track-metadata-genre-enrichment).
 *
 * Answers ONE question before we build the enrichment pipeline: do QQ / NetEase song-detail
 * responses actually carry genre / style / tag / language metadata we could feed the DJ?
 *
 * The app's stream-source parsers (`qqSongToHit` / `neteaseSongToHit`) drop everything but
 * title/artist/album/duration, so this probe RE-ISSUES the same authenticated detail request
 * (the user's cookie + muzfetch, via the injected {@link StreamHttp}) and returns the RAW
 * genre-bearing fields — it NEVER returns the cookie. Loaded only under `import.meta.env.DEV`
 * (dynamic-import from the perf-control bridge), so it is tree-shaken from production.
 */
import { type StreamHttp, withQuery } from "@/streamsrc/http";
import { eapiEncrypt } from "@/streamsrc/netease/netease-crypto";
import { QQ_MUSICU_URL } from "@/streamsrc/qq/qq-resolve";
import { parseQqMusicKey, QQ_GUEST_GTK, qqGtk } from "@/streamsrc/qq/qq-sign";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Strip an optional `callback(...)` JSONP wrapper QQ sometimes returns (mirror of qq-source). */
function unwrapJsonp(text: string): string {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (text.startsWith("callback") && open > 0 && close > open) return text.slice(open + 1, close);
  return text;
}

/**
 * QQ `music.pf_song_detail_svr / get_song_detail_yqq` RAW json. Genre/language/company live
 * under `data.info.{genre,lan,pub_time,company}` as `{title, content:[{value}]}` blocks — the
 * richer sibling of `data.track_info` that `parseQqSongDetail` keeps.
 */
export async function qqRawSongDetail(
  http: StreamHttp,
  mid: string,
  cookie?: string,
): Promise<unknown> {
  const musickey = parseQqMusicKey(cookie);
  const gtk = musickey ? qqGtk(musickey) : QQ_GUEST_GTK;
  const body = {
    songinfo: {
      module: "music.pf_song_detail_svr",
      method: "get_song_detail_yqq",
      param: { song_mid: mid },
    },
  };
  const url = withQuery(QQ_MUSICU_URL, {
    format: "json",
    g_tk: String(gtk),
    data: JSON.stringify(body),
  });
  const headers: Record<string, string> = { "User-Agent": UA, Referer: "https://y.qq.com" };
  if (cookie) headers.Cookie = cookie;
  const res = await http({ url, method: "GET", headers });
  return JSON.parse(unwrapJsonp(await res.text()));
}

/**
 * NetEase eapi `/api/v3/song/detail` RAW json (mirrors netease-source `songDetailHits`, minus
 * the genre-dropping parser). NetEase is notoriously genre-poor — this proves whether anything
 * usable comes back at all.
 */
export async function neteaseRawSongDetail(
  http: StreamHttp,
  id: string,
  cookie?: string,
): Promise<unknown> {
  const c = JSON.stringify([{ id: Number(id) }]);
  const { params } = eapiEncrypt("/api/v3/song/detail", JSON.stringify({ c }));
  const body = `params=${encodeURIComponent(params)}`;
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: "https://music.163.com",
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: cookie ? `${cookie}; os=pc; appver=8.10.35` : "os=pc; appver=8.10.35",
  };
  const res = await http({
    url: "https://interface.music.163.com/eapi/v3/song/detail",
    method: "POST",
    headers,
    body,
  });
  return JSON.parse(await res.text());
}

const GENRE_KEY = /genre|style|\btag\b|\blan\b|language|mood|theme|流派|风格|类型|语种/i;

/** A compact preview so a big subtree doesn't flood the wire. */
function previewValue(v: unknown): unknown {
  const s = JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > 400 ? `${s.slice(0, 400)}…` : v;
}

/**
 * Recursively collect fields whose KEY looks genre/style/tag/language-ish (with their values)
 * so we SEE whether the vendor carries the data and under what shape, regardless of nesting.
 * Pure + cycle-safe + capped. An empty result = "this endpoint has no genre metadata".
 */
export function scanGenreFields(
  root: unknown,
  maxHits = 40,
): Array<{ path: string; value: unknown }> {
  const out: Array<{ path: string; value: unknown }> = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown, path: string): void => {
    if (out.length >= maxHits || node == null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.slice(0, 20).forEach((v, i) => {
        walk(v, `${path}[${i}]`);
      });
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (GENRE_KEY.test(k)) out.push({ path: p, value: previewValue(v) });
      walk(v, p);
    }
  };
  walk(root, "");
  return out;
}
