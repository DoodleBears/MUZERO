import { rgbaToThumbHash } from "thumbhash";
import { describe, expect, it } from "vitest";
import {
  coverPaletteFields,
  coverPaletteFromThumbhash,
  normalizeCoverPalette,
} from "./cover-palette";
import { thumbhashToBase64 } from "./cover-thumbhash";

describe("cover palette metadata", () => {
  it("normalizes stored palette colors for metadata and sync", () => {
    const palette = normalizeCoverPalette([
      { r: 20.4, g: 120.6, b: 220.2 },
      { r: 20, g: 121, b: 220 },
      { r: 999, g: -10, b: 30 },
      { r: Number.NaN, g: 0, b: 0 },
    ]);

    expect(palette).toEqual([
      { r: 20, g: 121, b: 220 },
      { r: 255, g: 0, b: 30 },
    ]);
  });

  it("stores source only when a usable palette exists", () => {
    expect(coverPaletteFields([{ r: 1, g: 2, b: 3 }], "blb_cover")).toEqual({
      coverPalette: [{ r: 1, g: 2, b: 3 }],
      coverPaletteSource: "blb_cover",
    });
    expect(coverPaletteFields([], "blb_cover")).toEqual({
      coverPalette: undefined,
      coverPaletteSource: undefined,
    });
  });

  it("derives a browser-safe fallback color from a cover thumbhash", () => {
    const hash = rgbaToThumbHash(1, 1, new Uint8ClampedArray([20, 120, 220, 255]));
    const palette = coverPaletteFromThumbhash(thumbhashToBase64(hash));

    expect(palette).toHaveLength(1);
    expect(palette[0]?.b).toBeGreaterThan(palette[0]?.r ?? 0);
    expect(palette[0]?.b).toBeGreaterThan(palette[0]?.g ?? 0);
  });
});
