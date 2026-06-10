/**
 * Textbook RSA (no padding) over BigInt — pure. NetEase weapi wraps its random AES
 * key with raw `m^e mod n` (no PKCS#1 padding) against a fixed 1024-bit public key,
 * so neither Web Crypto (PKCS1/OAEP only) nor any modern lib fits. We only need
 * encryption (public op), so this is just modular exponentiation + hex framing.
 *
 * Not a general-purpose RSA: no padding, no decryption, no key generation. It exists
 * solely to reproduce the platform's key-wrapping step.
 */

/** Modular exponentiation `base^exp mod mod` via right-to-left square-and-multiply. */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) | BigInt(byte);
  return n;
}

/** Byte width of a non-negative bigint (≥1). The modulus hex may carry a spurious leading 00. */
function byteLength(n: bigint): number {
  let bits = 0;
  let x = n;
  while (x > 0n) {
    x >>= 1n;
    bits += 1;
  }
  return Math.max(1, Math.ceil(bits / 8));
}

/**
 * Encrypt `message` (its UTF-8 bytes read big-endian as an integer) with the public
 * key `(modulusHex, exponentHex)`, returning lowercase hex left-padded to the
 * modulus width — matching what NetEase's `encSecKey` expects.
 */
export function rsaNoPadEncryptHex(
  message: string,
  modulusHex: string,
  exponentHex: string,
): string {
  const m = bytesToBigInt(new TextEncoder().encode(message));
  const n = BigInt(`0x${modulusHex}`);
  const e = BigInt(`0x${exponentHex}`);
  const cipher = modPow(m, e, n);
  // Pad to the modulus BYTE width (×2 hex), not the hex string length — the latter
  // may include a leading "00" byte, which would over-pad encSecKey to 258 vs 256.
  return cipher.toString(16).padStart(byteLength(n) * 2, "0");
}
