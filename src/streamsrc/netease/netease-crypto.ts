/**
 * NetEase Cloud Music request crypto — pure, browser-safe (no Node `crypto`). Two
 * schemes, reproduced from the public web client:
 *   - weapi: AES-128-CBC(presetKey) → AES-128-CBC(randomKey), both base64; the random
 *     key is RSA-wrapped (no padding) into `encSecKey`. Used for search.
 *   - eapi:  AES-128-ECB(eapiKey) over `path-…-text-…-md5(nobody…md5forencrypt)`,
 *     uppercase hex. Used to fetch playback URLs (`/api/song/enhance/player/url/v1`).
 *
 * The random weapi key is INJECTED by callers (`randomSecretKey()` for production,
 * a fixed string in tests) so the transform is deterministic and unit-testable.
 * AES comes from `@noble/ciphers` (already used by the .ncm decoder); md5/rsa are our
 * vendored pure impls. Keys here are the platform's well-known public constants — no
 * user secret is embedded.
 */

import { cbc, ecb } from "@noble/ciphers/aes.js";
import { md5Hex } from "../crypto/md5";
import { rsaNoPadEncryptHex } from "../crypto/rsa";

export const PRESET_KEY = "0CoJUm6Qyw8W8jud";
export const WEAPI_IV = "0102030405060708";
export const EAPI_KEY = "e82ckenh8dichen8";

// NetEase weapi public key (1024-bit modulus, exponent 0x10001).
const PUB_MODULUS =
  "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
const PUB_EXPONENT = "010001";

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function aesCbcBase64(key: string, ivStr: string, text: string): string {
  const out = cbc(enc.encode(key), enc.encode(ivStr)).encrypt(enc.encode(text));
  return bytesToBase64(out);
}

export interface WeapiPayload {
  params: string;
  encSecKey: string;
}

/** weapi: double AES-CBC + RSA-wrapped random key. `secretKey` is the injected 16-char key. */
export function weapiEncrypt(text: string, secretKey: string): WeapiPayload {
  const inner = aesCbcBase64(PRESET_KEY, WEAPI_IV, text);
  const params = aesCbcBase64(secretKey, WEAPI_IV, inner);
  const reversed = secretKey.split("").reverse().join("");
  const encSecKey = rsaNoPadEncryptHex(reversed, PUB_MODULUS, PUB_EXPONENT);
  return { params, encSecKey };
}

export interface EapiPayload {
  params: string;
}

/**
 * eapi: AES-128-ECB(eapiKey) over the digest-framed payload, uppercase hex.
 * `apiPath` is the `/api/...` form (the request is POSTed to the `/eapi/...` mirror).
 */
export function eapiEncrypt(apiPath: string, text: string): EapiPayload {
  const digest = md5Hex(`nobody${apiPath}use${text}md5forencrypt`);
  const data = `${apiPath}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const out = ecb(enc.encode(EAPI_KEY)).encrypt(enc.encode(data));
  return { params: bytesToHex(out).toUpperCase() };
}

const SECRET_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A fresh 16-char weapi secret key (production path; non-deterministic by design). */
export function randomSecretKey(): string {
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let key = "";
  for (const r of rnd) key += SECRET_ALPHABET[r % SECRET_ALPHABET.length];
  return key;
}

/** Test seam: reverse weapi's outer CBC layer so a round-trip can assert the payload. */
export function weapiDecryptForTest(params: string, secretKey: string): string {
  const inner = dec.decode(
    cbc(enc.encode(secretKey), enc.encode(WEAPI_IV)).decrypt(base64ToBytes(params)),
  );
  const text = dec.decode(
    cbc(enc.encode(PRESET_KEY), enc.encode(WEAPI_IV)).decrypt(base64ToBytes(inner)),
  );
  return text;
}
