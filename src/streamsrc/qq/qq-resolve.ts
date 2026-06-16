/**
 * QQ Music playable-URL resolution — pure. We ask GetVkey for a batch of candidate
 * plaintext filenames (best→worst) and the server answers with `midurlinfo[]` (one
 * purl per filename) + a `sip[]` CDN host list. The caller picks the first candidate
 * with a non-empty purl; an all-empty result = no plaintext stream (VIP / encrypted-
 * only / removed). Guest params (uin=0, guid, platform=20, loginflag=1) per
 * NeriPlayer-Desktop; the CDN host is whatever `sip` returns (fallback isure.stream).
 *
 * The exact musicu module/method strings are runtime-verifiable (PRD Phase 2); these
 * pure functions lock down the request shape and the response parsing.
 */

export const QQ_MUSICU_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
export const QQ_VKEY_MODULE = "music.vkey.GetVkey";
export const QQ_VKEY_METHOD = "UrlGetVkey";
export const QQ_STREAM_FALLBACK_HOST = "https://isure.stream.qqmusic.qq.com/";

export interface QqVkeyParam {
  guid: string;
  songmid: string;
  uin?: string;
  /** The qqmusic_key value (login). Carried in `comm.authst` to unlock the user's
   *  tiers — musicu authenticates via the body's comm block, not just the cookie. */
  musickey?: string;
}

/**
 * Build the musicu.fcg `data` body requesting vkeys for a batch of filenames.
 * The `comm` block carries auth: guest sends uin=0 with no authst; a logged-in
 * request sends the real uin + `authst`(musickey) + `tmeLoginType` (1=wechat for a
 * `W_X…` key, else 2=QQ). Without it the server treats us as anonymous and returns
 * empty purls for permission-gated songs (→ false no-permission).
 */
export function qqVkeyRequestBody(filenames: string[], p: QqVkeyParam) {
  const uin = p.uin ?? "0";
  const comm: { uin: string; format: string; ct: number; cv: number } & {
    authst?: string;
    tmeLoginType?: number;
  } = { uin, format: "json", ct: 24, cv: 0 };
  if (p.musickey) {
    comm.authst = p.musickey;
    comm.tmeLoginType = p.musickey.startsWith("W_X") ? 1 : 2;
  }
  return {
    comm,
    req_0: {
      module: QQ_VKEY_MODULE,
      method: QQ_VKEY_METHOD,
      param: {
        guid: p.guid,
        songmid: filenames.map(() => p.songmid),
        songtype: filenames.map(() => 0),
        uin,
        loginflag: 1,
        platform: "20",
        filename: filenames,
      },
    },
  };
}

export interface QqVkeyEntry {
  filename: string;
  purl: string;
}
export interface QqVkeyData {
  entries: QqVkeyEntry[];
  sip: string[];
}

interface RawVkeyData {
  midurlinfo?: Array<{ filename?: unknown; purl?: unknown }>;
  sip?: unknown[];
}
interface RawVkeyRoot {
  req_0?: { data?: RawVkeyData };
  req_1?: { data?: RawVkeyData };
  data?: RawVkeyData;
}

/** Parse a GetVkey response into per-filename purls + the CDN host list. */
export function parseQqVkey(raw: string | object): QqVkeyData | null {
  let root: RawVkeyRoot;
  try {
    root = (typeof raw === "string" ? JSON.parse(raw) : raw) as RawVkeyRoot;
  } catch {
    return null;
  }
  const data = root?.req_0?.data ?? root?.req_1?.data ?? root?.data;
  if (!data || typeof data !== "object") return null;
  const midurlinfo = Array.isArray(data.midurlinfo) ? data.midurlinfo : [];
  const sip = Array.isArray(data.sip)
    ? data.sip.filter((s): s is string => typeof s === "string")
    : [];
  const entries: QqVkeyEntry[] = midurlinfo.map((m) => ({
    filename: typeof m?.filename === "string" ? m.filename : "",
    purl: typeof m?.purl === "string" ? m.purl : "",
  }));
  return { entries, sip };
}

/** Pick a usable CDN host from `sip` (prefer https; upgrade http; else fallback). */
export function qqStreamHost(sip: string[]): string {
  const https = sip.find((s) => s.startsWith("https://"));
  if (https) return https;
  const http = sip.find((s) => s.startsWith("http://"));
  if (http) return `https://${http.slice("http://".length)}`;
  return QQ_STREAM_FALLBACK_HOST;
}

/** Join a CDN host and a purl path into a full stream URL (no doubled slash). */
export function qqStreamUrl(sip: string[], purl: string): string {
  const host = qqStreamHost(sip);
  const path = purl.replace(/^\//, "");
  return host.endsWith("/") ? `${host}${path}` : `${host}/${path}`;
}
