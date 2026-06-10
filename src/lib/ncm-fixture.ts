/**
 * Test-only fixture: build a valid `.ncm` container in-memory so {@link decodeNcm}
 * can be exercised end-to-end without shipping a real (copyrighted) sample. NOT
 * imported by app code — only by `*.test.ts`. The encode path mirrors the format
 * in `ncm-decode.ts` but deliberately uses the *naive* per-byte RC4 PRGA (no
 * 256-period precompute) so a round-trip cross-checks the decoder's optimization.
 */

import { ecb } from "@noble/ciphers/aes.js";

const CORE_KEY = Uint8Array.from([
  0x68, 0x7a, 0x48, 0x52, 0x41, 0x6d, 0x73, 0x6f, 0x35, 0x6b, 0x49, 0x6e, 0x62, 0x61, 0x78, 0x57,
]);
const META_KEY = Uint8Array.from([
  0x23, 0x31, 0x34, 0x6c, 0x6a, 0x6b, 0x5f, 0x21, 0x5c, 0x5d, 0x26, 0x30, 0x55, 0x3c, 0x27, 0x28,
]);
const MAGIC = Uint8Array.from([0x43, 0x54, 0x45, 0x4e, 0x46, 0x44, 0x41, 0x4d]);
const KEY_PREFIX = textBytes("neteasecloudmusic");
const META_PREFIX = "163 key(Don't modify):";
const MUSIC_PREFIX = textBytes("music:");

/** A fixed, arbitrary RC4 key seed — length is irrelevant to the algorithm. */
const DEFAULT_RC4_SEED = textBytes("NETEASE-RC4-KEY-SEED/0123456789abcdef");

export interface NcmFixtureInput {
  /** Plaintext audio bytes to embed (recovered verbatim by the decoder). */
  audio: Uint8Array;
  /** Container JSON metadata object (musicName/artist/album/albumPic/format/…). */
  meta?: Record<string, unknown>;
  /** Embedded cover image bytes (omit for the "fetch remote albumPic" path). */
  cover?: Uint8Array;
  /**
   * Extra reserved image-space bytes after the cover (imageSpace − imageSize).
   * Real `.ncm` files reserve space the audio must skip past; set > 0 to exercise
   * the audio-offset = metaEnd + 13 + imageSpace logic.
   */
  coverPadding?: number;
  /**
   * Override the metadata block with a real, readable "163 key(Don't modify):…"
   * string (pre-XOR). Lets a test feed a real-world sample through the actual
   * AES/base64 metadata path. Takes precedence over `meta`.
   */
  rawMetaReadable?: string;
  rc4Seed?: Uint8Array;
}

export function encodeNcm(input: NcmFixtureInput): ArrayBuffer {
  const seed = input.rc4Seed ?? DEFAULT_RC4_SEED;
  const parts: Uint8Array[] = [];

  parts.push(MAGIC, new Uint8Array(2)); // magic + version gap

  // RC4 key block: AES-ECB("neteasecloudmusic"+seed) then `^ 0x64`.
  const keyPlain = concat(KEY_PREFIX, seed);
  const keyData = xor(ecb(CORE_KEY).encrypt(keyPlain), 0x64);
  parts.push(u32(keyData.length), keyData);

  // Metadata block: readable "163 key…"+base64 then `^ 0x63`.
  const readable = input.rawMetaReadable ?? buildReadableMeta(input.meta);
  if (readable === null) {
    parts.push(u32(0));
  } else {
    const metaData = xor(textBytes(readable), 0x63);
    parts.push(u32(metaData.length), metaData);
  }

  // [5-byte gap][imageSpace u32][imageSize u32][image][padding]. The audio begins
  // after the FULL imageSpace, so padding > 0 forces a real gap before the audio.
  parts.push(new Uint8Array(5));
  const cover = input.cover ?? new Uint8Array(0);
  const padding = input.coverPadding ?? 0;
  parts.push(u32(cover.length + padding), u32(cover.length), cover, new Uint8Array(padding));

  // Audio: naive per-byte RC4 stream XOR (decrypt == encrypt).
  parts.push(rc4Naive(input.audio, seed));

  const out = concatAll(parts);
  return out.buffer.slice(0) as ArrayBuffer;
}

function buildReadableMeta(meta: Record<string, unknown> | undefined): string | null {
  return meta ? encode163KeyComment(meta) : null;
}

/**
 * Build the readable "163 key(Don't modify):…" string NetEase writes into the ID3
 * comment of an exported plaintext mp3 — for testing {@link parse163KeyComment}.
 */
export function encode163KeyComment(meta: Record<string, unknown>): string {
  const plain = concat(MUSIC_PREFIX, textBytes(JSON.stringify(meta)));
  return META_PREFIX + bytesToBase64(ecb(META_KEY).encrypt(plain));
}

// --- naive RC4 (independent of the decoder's precomputed keystream) -----------

function rc4Naive(data: Uint8Array, seed: Uint8Array): Uint8Array {
  const box = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) box[i] = i;
  let last = 0;
  let offset = 0;
  for (let i = 0; i < 256; i += 1) {
    const swap = box[i];
    const c = (swap + last + seed[offset]) & 0xff;
    offset = (offset + 1) % seed.length;
    box[i] = box[c];
    box[c] = swap;
    last = c;
  }
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const j = (i + 1) & 0xff;
    out[i] = data[i] ^ box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff];
  }
  return out;
}

// --- byte helpers -------------------------------------------------------------

function textBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function xor(bytes: Uint8Array, value: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) out[i] = bytes[i] ^ value;
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  return concatAll([a, b]);
}

function concatAll(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
