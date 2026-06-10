/**
 * MD5 (RFC 1321) — hand-rolled, pure, dependency-free. We need MD5 for the NetEase
 * eapi request digest and the Bilibili WBI `w_rid`, but the tree has no
 * `@noble/hashes` and Web Crypto deliberately omits MD5 (legacy). Adding a npm dep
 * here would collide with concurrently-edited `package.json` / lockfile, so we
 * vendor the ~100 lines instead. Pinned by RFC known-answer vectors in the test.
 *
 * Not for security — MD5 is broken as a hash. It's used here only to reproduce the
 * platforms' request-signing algorithms, never to protect anything.
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(2^32 * abs(sin(i + 1))) — precomputed to keep the hash pure of Math.
const K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === "string" ? new TextEncoder().encode(input) : input;
}

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

/** MD5 digest as lowercase 32-char hex. Input is hashed by bytes (UTF-8 for strings). */
export function md5Hex(input: string | Uint8Array): string {
  const msg = toBytes(input);
  const originalLenBits = msg.length * 8;

  // Pad: 0x80, then zeros until length ≡ 56 (mod 64), then 8-byte little-endian bit length.
  const withOne = msg.length + 1;
  const padded = new Uint8Array(Math.ceil((withOne + 8) / 64) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  // 64-bit length, low 32 bits then high 32 bits (little-endian). Songs/queries are
  // far under 2^32 bits, so the high word is effectively zero, but write it correctly.
  view.setUint32(padded.length - 8, originalLenBits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(originalLenBits / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const m = new Int32Array(16);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i += 1) m[i] = view.getUint32(chunk + i * 4, true);

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + K[i] + m[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(f, S[i])) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return leHex(a0) + leHex(b0) + leHex(c0) + leHex(d0);
}

/** A 32-bit word as little-endian (byte-reversed) lowercase hex — MD5's output order. */
function leHex(x: number): string {
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += ((x >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}
