/**
 * Pure URL assembly for YouTube ciphered streams. A format is either a plain `url`
 * or a `signatureCipher` (`s=…&sp=sig&url=…`) whose signature must be descrambled.
 * Either way the URL carries an `n` throttling param that must be transformed or the
 * CDN serves at a crippled rate.
 *
 * The actual descramble/transform algorithms live in YouTube's obfuscated player.js
 * and can only run in a real JS engine (the hidden BrowserWindow solver) — so they're
 * INJECTED here as `solveSig`/`solveN`. This module only parses + reassembles, which
 * is fully unit-testable with stub solvers.
 */

export interface SignatureCipher {
  /** The scrambled signature to descramble. */
  s: string;
  /** The query param name to attach the descrambled signature to (usually "sig"). */
  sp: string;
  /** The base media URL. */
  url: string;
}

/** Parse a `signatureCipher` query string into its parts, or null if malformed. */
export function parseSignatureCipher(cipher: string): SignatureCipher | null {
  const params = new URLSearchParams(cipher);
  const s = params.get("s");
  const url = params.get("url");
  if (!s || !url) return null;
  return { s, sp: params.get("sp") || "signature", url };
}

/** Read a query param from a URL (null if absent / unparseable). */
export function getQueryParam(url: string, name: string): string | null {
  try {
    return new URL(url).searchParams.get(name);
  } catch {
    return null;
  }
}

/** Return the URL with `name=value` set (re-encoding correctly). */
export function setQueryParam(url: string, name: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(name, value);
  return u.toString();
}

export interface CipherSolvers {
  /** Descramble a scrambled signature (player.js sig function). */
  solveSig: (s: string) => string;
  /** Transform the `n` throttling param (player.js n function). */
  solveN: (n: string) => string;
}

/**
 * Turn a format into a final playable URL: descramble the signature when ciphered,
 * then transform the `n` param. Returns null when the format has neither a url nor a
 * usable cipher. Pure — the descramble/transform are injected.
 */
export function resolveFormatUrl(
  format: { url?: string; signatureCipher?: string },
  solvers: CipherSolvers,
): string | null {
  let url: string;
  if (format.signatureCipher) {
    const cipher = parseSignatureCipher(format.signatureCipher);
    if (!cipher) return null;
    url = setQueryParam(cipher.url, cipher.sp, solvers.solveSig(cipher.s));
  } else if (format.url) {
    url = format.url;
  } else {
    return null;
  }
  const n = getQueryParam(url, "n");
  if (n) url = setQueryParam(url, "n", solvers.solveN(n));
  return url;
}
