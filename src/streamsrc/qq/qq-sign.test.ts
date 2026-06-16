import { describe, expect, it } from "vitest";
import { hash33, parseQqMusicKey, parseQqUin, QQ_GUEST_GTK, qqGtk, qqPtqrtoken } from "./qq-sign";

describe("hash33", () => {
  it("returns the seed for an empty string", () => {
    expect(hash33("")).toBe(5381);
    expect(hash33("", 0)).toBe(0);
  });
  it("matches hand-computed djb2 vectors (seed 5381)", () => {
    // h = 5381; '0'(48): 5381 + (5381<<5) + 48 = 177621
    expect(hash33("0")).toBe(177621);
    // then '2'(50): 177621... wait next char '1' first
    // "12": '1'(49)->177622, '2'(50)->5861576
    expect(hash33("12")).toBe(5861576);
  });
  it("uses the given seed (0)", () => {
    expect(hash33("0", 0)).toBe(48);
  });
});

describe("g_tk / ptqrtoken", () => {
  it("guest g_tk is the degenerate 5381", () => {
    expect(QQ_GUEST_GTK).toBe(5381);
    expect(qqGtk("")).toBe(5381);
  });
  it("qqGtk hashes the musickey with seed 5381", () => {
    expect(qqGtk("0")).toBe(177621);
  });
  it("qqPtqrtoken hashes the qrsig with seed 0 (distinct from g_tk)", () => {
    expect(qqPtqrtoken("0")).toBe(48);
    expect(qqPtqrtoken("0")).not.toBe(qqGtk("0"));
  });
});

describe("parseQqMusicKey", () => {
  it("extracts qqmusic_key from a cookie string", () => {
    expect(parseQqMusicKey("qqmusic_uin=123; qqmusic_key=W_X_abc; other=1")).toBe("W_X_abc");
  });
  it("returns undefined when absent / empty", () => {
    expect(parseQqMusicKey(undefined)).toBeUndefined();
    expect(parseQqMusicKey("foo=bar")).toBeUndefined();
  });
  it("keeps '=' characters inside the value", () => {
    expect(parseQqMusicKey("qqmusic_key=a=b=c")).toBe("a=b=c");
  });
});

describe("parseQqUin", () => {
  it("extracts qqmusic_uin from a cookie string", () => {
    expect(parseQqUin("qqmusic_uin=12345; qqmusic_key=W_X_abc")).toBe("12345");
  });
  it("returns undefined when absent / empty", () => {
    expect(parseQqUin(undefined)).toBeUndefined();
    expect(parseQqUin("qqmusic_key=W_X_abc")).toBeUndefined();
  });
});
