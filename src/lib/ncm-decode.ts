/**
 * NetEase Cloud Music `.ncm` decoder — turns one encrypted container into a
 * plaintext audio blob + its embedded metadata (title/artist/album + a cover URL
 * or embedded image). Pure (no DOM / no DB / no network), so it runs inside the
 * heavy import Worker; the only outbound piece — downloading the `albumPic` cover
 * when none is embedded — happens on the main thread via `getAppFetch()`, because
 * Workers can't reach the desktop bridge.
 *
 * Format (little-endian lengths), mirrored from the reference Go implementation
 * (`taurusxin/ncmdump-go`):
 *   1. magic  "CTENFDAM" (8 bytes) + 2-byte version gap
 *   2. keyLen (u32) + keyData: each byte `^ 0x64`, AES-128-ECB(coreKey)+PKCS7,
 *      then drop the 17-byte "neteasecloudmusic" prefix → the RC4 key seed
 *   3. metaLen (u32) + metaData: each byte `^ 0x63`, drop the 22-byte
 *      "163 key(Don't modify):" prefix, base64-decode, AES-128-ECB(metaKey)+PKCS7,
 *      drop the 6-byte "music:" prefix → JSON
 *   4. 4-byte CRC32 + 5-byte gap (9 skipped), then imageSize (u32) + cover bytes
 *   5. remaining bytes = RC4-stream-encrypted audio
 *
 * The RC4 keystream depends only on `i mod 256` (the keybox is fixed), so it has a
 * 256-byte period — we precompute one period and XOR, instead of re-deriving per
 * byte over a whole song.
 *
 * Scope note: this is local format conversion of the user's own library (their
 * `.ncm` files → playable audio on-device). It does not contact NetEase except to
 * GET the cover URL the file already carries; no key/endpoint is hidden.
 */

import { ecb } from "@noble/ciphers/aes.js";

// "CTENFDAM"
const MAGIC = Uint8Array.from([0x43, 0x54, 0x45, 0x4e, 0x46, 0x44, 0x41, 0x4d]);
// AES key for the RC4-key block: "hzHRAmso5kInbaxW"
const CORE_KEY = Uint8Array.from([
  0x68, 0x7a, 0x48, 0x52, 0x41, 0x6d, 0x73, 0x6f, 0x35, 0x6b, 0x49, 0x6e, 0x62, 0x61, 0x78, 0x57,
]);
// AES key for the metadata block: "#14ljk_!\]&0U<'("
const META_KEY = Uint8Array.from([
  0x23, 0x31, 0x34, 0x6c, 0x6a, 0x6b, 0x5f, 0x21, 0x5c, 0x5d, 0x26, 0x30, 0x55, 0x3c, 0x27, 0x28,
]);

const HEADER_GAP = 2; // version bytes after the magic
const KEY_PREFIX_LEN = 17; // "neteasecloudmusic"
const MUSIC_PREFIX_LEN = 6; // "music:"
const POST_META_GAP = 5; // gap bytes before the cover-frame header

/**
 * Marker prefixing the encrypted metadata blob. NetEase writes this same blob both
 * (a) inside the `.ncm` container AND (b) into the ID3 `COMM`/comment frame of the
 * exported plaintext mp3 — so a decrypted-on-disk file still carries it. See
 * {@link parse163KeyComment}.
 */
export const NETEASE_163_PREFIX = "163 key(Don't modify):";

export interface NcmMeta {
  musicName?: string;
  artists: string[];
  album?: string;
  /** CDN URL the file carries for its cover; downloaded only if no image is embedded. */
  albumPicUrl?: string;
  /** "mp3" | "flac" per the container metadata. */
  format?: string;
  durationMs?: number;
  bitrate?: number;
}

export interface NcmCover {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
}

export interface NcmDecoded {
  /** Decrypted, playable audio bytes (mp3 or flac). */
  audio: Uint8Array<ArrayBuffer>;
  audioMime: string;
  meta: NcmMeta;
  /** Cover image embedded in the container, if any (else fall back to `meta.albumPicUrl`). */
  cover?: NcmCover;
}

/** Whether a filename is a NetEase `.ncm` container (the one store format we decrypt). */
export function isNcmFile(name: string): boolean {
  return /\.ncm$/i.test(name);
}

/** Decode a `.ncm` container into plaintext audio + metadata. Throws on a bad header. */
export function decodeNcm(input: ArrayBuffer | Uint8Array): NcmDecoded {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.byteLength < MAGIC.length + HEADER_GAP + 4 || !hasMagic(bytes)) {
    throw new Error("Not a NetEase .ncm file (bad magic header)");
  }
  let off = MAGIC.length + HEADER_GAP;

  // --- RC4 key seed -----------------------------------------------------------
  const keyLen = view.getUint32(off, true);
  off += 4;
  if (keyLen <= 0 || off + keyLen > bytes.byteLength) throw new Error("ncm: invalid key length");
  const keyData = bytes.slice(off, off + keyLen);
  off += keyLen;
  for (let i = 0; i < keyData.length; i += 1) keyData[i] ^= 0x64;
  const decryptedKey = ecb(CORE_KEY).decrypt(keyData); // PKCS7-stripped
  const rc4Seed = decryptedKey.subarray(KEY_PREFIX_LEN);
  if (rc4Seed.length === 0) throw new Error("ncm: empty RC4 key");

  // --- metadata JSON ----------------------------------------------------------
  const metaLen = view.getUint32(off, true);
  off += 4;
  let meta: NcmMeta = { artists: [] };
  if (metaLen > 0) {
    if (off + metaLen > bytes.byteLength) throw new Error("ncm: invalid metadata length");
    const metaData = bytes.slice(off, off + metaLen);
    off += metaLen;
    for (let i = 0; i < metaData.length; i += 1) metaData[i] ^= 0x63;
    meta = decodeMeta(metaData);
  }

  // --- embedded cover ---------------------------------------------------------
  // Layout after the metadata block: [5-byte gap][imageSpace u32][imageSize u32]
  // [image: imageSize bytes][padding: imageSpace − imageSize bytes]. The audio
  // begins after the FULL reserved image space — so when imageSpace > imageSize
  // (e.g. imageSize 0 but a few KB reserved), advancing by imageSize would land
  // mid-padding and decrypt to garbage. Advance by imageSpace.
  off += POST_META_GAP;
  let cover: NcmCover | undefined;
  if (off + 8 <= bytes.byteLength) {
    const imageSpace = view.getUint32(off, true);
    off += 4;
    const imageSize = view.getUint32(off, true);
    off += 4;
    if (imageSize > 0 && off + imageSize <= bytes.byteLength) {
      const img = bytes.slice(off, off + imageSize);
      cover = { bytes: img, mime: sniffImageMime(img) };
    }
    off += imageSpace;
  }

  // --- audio stream -----------------------------------------------------------
  const audio = rc4Decrypt(bytes.slice(off), rc4Seed);
  return { audio, audioMime: audioMimeFor(meta.format, audio), meta, cover };
}

function hasMagic(bytes: Uint8Array): boolean {
  for (let i = 0; i < MAGIC.length; i += 1) if (bytes[i] !== MAGIC[i]) return false;
  return true;
}

/** Container path: the metadata block, already `^ 0x63`-decoded to its ASCII form. */
function decodeMeta(xored: Uint8Array): NcmMeta {
  let ascii = "";
  for (let i = 0; i < xored.length; i += 1) ascii += String.fromCharCode(xored[i]);
  return parse163KeyComment(ascii) ?? { artists: [] };
}

/**
 * Parse a "163 key(Don't modify):…" string — the NetEase metadata blob as it
 * appears in BOTH a decoded `.ncm` metadata block AND the ID3 comment frame of an
 * exported plaintext mp3/flac. Returns null if the text isn't a 163-key blob or
 * fails to decrypt, so callers can treat a normal comment as "no NetEase data".
 */
export function parse163KeyComment(comment: string): NcmMeta | null {
  const text = comment.trimStart();
  if (!text.startsWith(NETEASE_163_PREFIX)) return null;
  // ID3 readers may wrap long comments; strip any whitespace before base64-decoding.
  const b64 = text.slice(NETEASE_163_PREFIX.length).replace(/\s+/g, "");
  let plain: Uint8Array;
  try {
    plain = ecb(META_KEY).decrypt(base64ToBytes(b64));
  } catch {
    return null;
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(utf8(plain.subarray(MUSIC_PREFIX_LEN))) as Record<string, unknown>;
  } catch {
    return null;
  }
  return {
    musicName: asString(json.musicName),
    artists: parseArtists(json.artist),
    album: asString(json.album),
    albumPicUrl: asString(json.albumPic),
    format: asString(json.format),
    durationMs: asNumber(json.duration),
    bitrate: asNumber(json.bitrate),
  };
}

/** NetEase stores `artist` as an array of `[name, id]` tuples. */
function parseArtists(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (Array.isArray(item) && item.length > 0 && item[0] != null) out.push(String(item[0]));
    else if (typeof item === "string" && item.trim()) out.push(item.trim());
  }
  return out;
}

// --- RC4 stream (NetEase variant) ---------------------------------------------

function buildKeyBox(key: Uint8Array): Uint8Array {
  const box = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) box[i] = i;
  const keyLen = key.length;
  let last = 0;
  let offset = 0;
  for (let i = 0; i < 256; i += 1) {
    const swap = box[i];
    const c = (swap + last + key[offset]) & 0xff;
    offset = (offset + 1) % keyLen;
    box[i] = box[c];
    box[c] = swap;
    last = c;
  }
  return box;
}

function rc4Decrypt(data: Uint8Array, seed: Uint8Array): Uint8Array<ArrayBuffer> {
  const box = buildKeyBox(seed);
  // Keystream byte at position i depends only on (i mod 256) → one 256-byte period.
  const ks = new Uint8Array(256);
  for (let p = 0; p < 256; p += 1) {
    const j = (p + 1) & 0xff;
    ks[p] = box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff];
  }
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = data[i] ^ ks[i & 0xff];
  return out;
}

// --- small codecs / sniffers --------------------------------------------------

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64.trim());
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function audioMimeFor(format: string | undefined, audio: Uint8Array): string {
  const fmt = format?.toLowerCase();
  if (fmt === "flac") return "audio/flac";
  if (fmt === "mp3") return "audio/mpeg";
  // Fall back to sniffing the decrypted stream ("fLaC" magic → FLAC).
  if (
    audio.length >= 4 &&
    audio[0] === 0x66 &&
    audio[1] === 0x4c &&
    audio[2] === 0x61 &&
    audio[3] === 0x43
  ) {
    return "audio/flac";
  }
  return "audio/mpeg";
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  return "image/jpeg";
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
