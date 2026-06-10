import { describe, expect, it } from "vitest";
import { modPow, rsaNoPadEncryptHex } from "./rsa";

/** The NetEase weapi public modulus (1024-bit, leading 00) — used for the width check. */
const NETEASE_MOD =
  "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";

describe("modPow", () => {
  it("matches the textbook RSA example (n=3233, e=17): 65^17 mod 3233 = 2790", () => {
    expect(modPow(65n, 17n, 3233n)).toBe(2790n);
  });

  it("handles base 0 and exponent 0", () => {
    expect(modPow(0n, 5n, 7n)).toBe(0n);
    expect(modPow(4n, 0n, 7n)).toBe(1n);
  });

  it("agrees with a naive reference for small inputs", () => {
    const naive = (b: bigint, e: bigint, m: bigint) => {
      let r = 1n;
      for (let i = 0n; i < e; i += 1n) r = (r * b) % m;
      return r;
    };
    for (const [b, e, m] of [
      [7n, 13n, 19n],
      [123n, 45n, 567n],
      [2n, 100n, 1000n],
    ] as const) {
      expect(modPow(b, e, m)).toBe(naive(b, e, m));
    }
  });
});

describe("rsaNoPadEncryptHex", () => {
  it("encodes the message bytes as a big-endian integer, then m^e mod n", () => {
    // "A" → byte 0x41 = 65; textbook key → 65^17 mod 3233 = 2790 = 0x0ae6.
    expect(rsaNoPadEncryptHex("A", "0ca1", "11")).toBe("0ae6");
  });

  it("left-pads the ciphertext to the modulus hex width", () => {
    expect(rsaNoPadEncryptHex("A", "0ca1", "11")).toHaveLength(4);
  });

  it("produces 256-hex (128-byte) ciphertext for the 1024-bit NetEase key", () => {
    // The canonical modulus string carries a leading 00 byte → 258 hex chars, but the
    // real encSecKey is 256 (the modulus is 128 bytes). Padding follows byte width.
    expect(NETEASE_MOD).toHaveLength(258);
    const out = rsaNoPadEncryptHex("0123456789abcdef", NETEASE_MOD, "010001");
    expect(out).toMatch(/^[0-9a-f]+$/);
    expect(out).toHaveLength(256);
  });
});
