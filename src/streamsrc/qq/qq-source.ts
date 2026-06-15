/**
 * QQ Music StreamSourceProvider — guest-first. Search hits `client_search_cp`;
 * resolve asks musicu GetVkey for a batch of PLAINTEXT candidate filenames and picks
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
  StreamResolveOptions,
  StreamResolveResult,
  StreamSearchHit,
  StreamSearchOptions,
  StreamSourceProvider,
} from "../provider";
import { parseQqSearch } from "./qq-playlists";
import { qqFilename, qqQualityCandidates } from "./qq-quality";
import { parseQqVkey, QQ_MUSICU_URL, qqStreamUrl, qqVkeyRequestBody } from "./qq-resolve";
import { parseQqMusicKey, QQ_GUEST_GTK, qqGtk } from "./qq-sign";

const SEARCH_URL = "https://c.y.qq.com/soso/fcgi-bin/client_search_cp";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REFERER = "https://y.qq.com";
/** NeriPlayer-Desktop guest device id; uin 0 = anonymous. */
const GUEST_GUID = "10000";
const GUEST_UIN = "0";

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
    const url = withQuery(SEARCH_URL, {
      format: "json",
      n: String(opts?.limit ?? 20),
      p: "1",
      w: query,
      cr: "1",
      g_tk: String(gtk()),
      inCharset: "utf8",
      outCharset: "utf-8",
    });
    const text = await get(url, opts?.signal);
    try {
      return parseQqSearch(JSON.parse(unwrapJsonp(text)));
    } catch {
      log.warn("qq", "search response is not JSON", { head: text.slice(0, 200) });
      return [];
    }
  }

  async function resolve(
    externalId: string,
    opts?: StreamResolveOptions,
  ): Promise<StreamResolveResult> {
    try {
      const candidates = qqQualityCandidates(opts?.quality);
      const filenames = candidates.map((t) => qqFilename(t, externalId));
      const body = qqVkeyRequestBody(filenames, { guid, songmid: externalId, uin: GUEST_UIN });
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
      return { kind: "no-permission", reason: "vip-or-encrypted" };
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    id: "qq",
    label: "QQ 音乐",
    requiresLogin: false,
    isAuthed: () => Boolean(deps.getCookie?.()),
    search,
    resolve,
  };
}
