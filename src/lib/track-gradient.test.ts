import { describe, expect, it } from "vitest";
import { hashString, trackGradient } from "./track-gradient";

describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("trk_abc")).toBe(hashString("trk_abc"));
  });
  it("differs for different inputs", () => {
    expect(hashString("trk_abc")).not.toBe(hashString("trk_abd"));
  });
  it("returns an unsigned 32-bit int", () => {
    const h = hashString("hello");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("trackGradient", () => {
  it("is deterministic for the same seed", () => {
    expect(trackGradient("trk_1")).toBe(trackGradient("trk_1"));
  });
  it("differs across seeds", () => {
    expect(trackGradient("trk_1")).not.toBe(trackGradient("trk_2"));
  });
  it("produces a valid two-stop HSL linear-gradient", () => {
    const g = trackGradient("trk_xyz");
    expect(g).toMatch(/^linear-gradient\(\d+deg, hsl\([^)]+\), hsl\([^)]+\)\)$/);
    expect((g.match(/hsl\(/g) ?? []).length).toBe(2);
  });
  it("keeps hue/sat/angle within CSS-valid ranges", () => {
    for (const seed of ["a", "trk_长", "🎵", "x".repeat(200)]) {
      const g = trackGradient(seed);
      const hues = [...g.matchAll(/hsl\((\d+),\s*(\d+)%/g)];
      expect(hues.length).toBe(2);
      for (const m of hues) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(0);
        expect(Number(m[1])).toBeLessThan(360);
        expect(Number(m[2])).toBeGreaterThanOrEqual(0);
        expect(Number(m[2])).toBeLessThanOrEqual(100);
      }
      const angle = Number(g.match(/\((\d+)deg/)?.[1]);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(360);
    }
  });
  it("falls back gracefully for an empty seed", () => {
    expect(trackGradient("")).toBe(trackGradient("muzero"));
  });
});
