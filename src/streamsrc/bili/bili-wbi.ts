/**
 * Bilibili WBI request signing — pure. The web API gates many endpoints (search,
 * playurl, view) behind a `w_rid` signature derived from a rotating key pair the
 * server publishes in `/x/web-interface/nav` (`wbi_img.img_url` / `sub_url`). Miss
 * the signature and you get -403/-352.
 *
 * Algorithm (mirrors SocialSisterYi/bilibili-API-collect):
 *   1. mixinKey = rerank(imgKey + subKey, MIXIN_INDEX)[:32]
 *   2. add `wts` (unix seconds); drop !'()* from every value; sort params by key
 *   3. w_rid = md5(urlencoded("k=v&…") + mixinKey)
 *
 * `wts` is injected (not read from a clock) so the signature is deterministic and
 * unit-testable — the network layer passes `Date.now()/1000`.
 */

import { md5Hex } from "../crypto/md5";

/** The fixed 64-entry permutation that reorders `imgKey+subKey` into the mixin key. */
export const WBI_MIXIN_INDEX: readonly number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 62, 6, 63, 57, 20, 34, 52, 59, 11, 36, 44,
];

/** `https://i0.hdslb.com/bfs/wbi/<key>.png` → `<key>` (filename without extension). */
export function extractWbiKeyFromUrl(url: string): string {
  const file = url.split("/").pop() ?? url;
  const dot = file.lastIndexOf(".");
  return dot >= 0 ? file.slice(0, dot) : file;
}

/** Rerank `imgKey + subKey` by {@link WBI_MIXIN_INDEX} and keep the first 32 chars. */
export function deriveMixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  let mixed = "";
  for (const idx of WBI_MIXIN_INDEX) {
    if (idx < raw.length) mixed += raw[idx];
  }
  return mixed.slice(0, 32);
}

export interface WbiSignResult {
  /** The exact "k=v&…" string that was md5'd (sorted, url-encoded, wts-appended). */
  query: string;
  /** All params including `wts` and `w_rid`, ready to attach to the request URL. */
  params: Record<string, string>;
  /** The signature. */
  wRid: string;
  /** The unix-second timestamp used. */
  wts: string;
}

/** Bilibili strips these characters from every value before signing. */
function filterValue(value: string): string {
  return value.replace(/[!'()*]/g, "");
}

/**
 * Sign `params` with `mixinKey` at timestamp `wtsSeconds` (unix seconds). Returns the
 * params to send (with `wts` + `w_rid`) and the canonical query that was hashed.
 */
export function signWbi(
  params: Record<string, string | number>,
  mixinKey: string,
  wtsSeconds: number,
): WbiSignResult {
  const wts = String(Math.floor(wtsSeconds));
  const filtered: Record<string, string> = { wts };
  for (const [k, v] of Object.entries(params)) {
    filtered[k] = filterValue(String(v));
  }

  const query = Object.keys(filtered)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(filtered[k])}`)
    .join("&");

  const wRid = md5Hex(query + mixinKey);
  return { query, params: { ...filtered, w_rid: wRid }, wRid, wts };
}
