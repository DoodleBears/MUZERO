import { describe, expect, it } from "vitest";
import { darken, FALLBACK_RGB, lighten, type Rgb, readPrimaryRgb, rgba } from "./visualizer-color";

const PURPLE: Rgb = { r: 191, g: 131, b: 254 };

describe("lighten", () => {
  it("returns the color unchanged at amount 0", () => {
    expect(lighten(PURPLE, 0)).toEqual(PURPLE);
  });
  it("returns white at amount 1", () => {
    expect(lighten(PURPLE, 1)).toEqual({ r: 255, g: 255, b: 255 });
  });
  it("mixes toward white at a fraction (rounded)", () => {
    // 191 + (255-191)*0.5 = 223 ; 131 + 124*0.5 = 193 ; 254 + 1*0.5 = 254.5 → 255
    expect(lighten(PURPLE, 0.5)).toEqual({ r: 223, g: 193, b: 255 });
  });
  it("clamps amount above 1 and below 0", () => {
    expect(lighten(PURPLE, 2)).toEqual({ r: 255, g: 255, b: 255 });
    expect(lighten(PURPLE, -1)).toEqual(PURPLE);
  });
});

describe("darken", () => {
  it("returns the color unchanged at amount 0", () => {
    expect(darken(PURPLE, 0)).toEqual(PURPLE);
  });
  it("returns black at amount 1", () => {
    expect(darken(PURPLE, 1)).toEqual({ r: 0, g: 0, b: 0 });
  });
  it("mixes toward black at a fraction (rounded)", () => {
    // 191*0.5=95.5→96 ; 131*0.5=65.5→66 ; 254*0.5=127
    expect(darken(PURPLE, 0.5)).toEqual({ r: 96, g: 66, b: 127 });
  });
  it("clamps amount above 1", () => {
    expect(darken(PURPLE, 5)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("rgba", () => {
  it("formats a CSS rgba() string", () => {
    expect(rgba(PURPLE, 0.5)).toBe("rgba(191, 131, 254, 0.5)");
    expect(rgba({ r: 0, g: 0, b: 0 }, 0)).toBe("rgba(0, 0, 0, 0)");
  });
});

describe("readPrimaryRgb", () => {
  it("returns a valid RGB triple (falls back to brand purple without a canvas)", () => {
    const c = readPrimaryRgb();
    for (const v of [c.r, c.g, c.b]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
    // jsdom has no 2D canvas context, so color resolution falls back.
    expect(c).toEqual(FALLBACK_RGB);
  });
});
