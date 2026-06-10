import { describe, expect, it } from "vitest";
import { md5Hex } from "./md5";

/**
 * RFC 1321 §A.5 known-answer vectors. MD5 is hand-rolled here (no `@noble/hashes`
 * in the tree, and Web Crypto has no MD5) because both the NetEase eapi digest and
 * the Bilibili WBI `w_rid` need it. These vectors pin correctness.
 */
describe("md5Hex", () => {
  const vectors: Array<[string, string]> = [
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "d174ab98d277d9f5a5611c2c9f419d9f",
    ],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ];

  it.each(vectors)("md5(%j) = %s", (input, expected) => {
    expect(md5Hex(input)).toBe(expected);
  });

  it("accepts raw bytes and matches the string form (UTF-8)", () => {
    expect(md5Hex(new TextEncoder().encode("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("hashes multibyte UTF-8 by bytes, not code units", () => {
    // "中文" → e4b8ad e69687 (UTF-8); reference value from a known MD5 implementation.
    expect(md5Hex("中文")).toBe("a7bac2239fcdcb3a067903d8077c4a07");
  });

  it("returns lowercase hex of length 32", () => {
    const h = md5Hex("anything");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});
