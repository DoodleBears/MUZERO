/**
 * QQ Music request hashing — pure, no crypto deps. QQ derives two tokens from a
 * djb2-style "hash33":
 *   - g_tk      = hash33(skey/musickey, seed 5381)  → signs WEB-platform requests
 *   - ptqrtoken = hash33(qrsig,         seed 0)      → QQ PTLogin QR poll token
 * Guest requests use the degenerate g_tk = 5381 (hash33 of an empty key). This is
 * NOT AES/MD5. The Android-client `zzc` SHA1 sign is a higher-effort fallback
 * (PRD Phase 5) and is intentionally not implemented here.
 *
 * NOTE: this matches Tencent's canonical front-end JS form (32-bit `<<`, Number
 * accumulator). For short keys it is unambiguous; for long musickeys the exact
 * value must be cross-checked against the live endpoint at login (PRD Phase 3
 * runtime), since the verified Python reference accumulates without per-step mask.
 */

/** Tencent djb2/hash33: h = seed; for each char h += (h<<5)+code; masked to 31 bits. */
export function hash33(input: string, seed = 5381): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash += (hash << 5) + input.charCodeAt(i);
  }
  return hash & 0x7fffffff;
}

/** Guest g_tk — hash33 of an empty skey/musickey (= the seed). */
export const QQ_GUEST_GTK = 5381;

/** Logged-in WEB g_tk from the qqmusic_key cookie value (seed 5381). */
export function qqGtk(musickey: string): number {
  return hash33(musickey, 5381);
}

/** QQ PTLogin QR poll token from the qrsig cookie (seed 0). */
export function qqPtqrtoken(qrsig: string): number {
  return hash33(qrsig, 0);
}

/** Pull the qqmusic_key value out of a stored cookie string (or undefined). */
export function parseQqMusicKey(cookie: string | undefined): string | undefined {
  if (!cookie) return undefined;
  for (const pair of cookie.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === "qqmusic_key" && rest.length) return rest.join("=");
  }
  return undefined;
}
