import { describe, expect, it } from "vitest";
import { selectDominantImageColor, selectImagePalette } from "./image-palette";

function pixels(colors: Array<[number, number, number, number?]>): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
}

/** Repeat a pixel `n` times so a cluster can dominate the bucket scoring. */
function repeat(color: [number, number, number, number?], n: number) {
  return Array.from({ length: n }, () => color);
}

describe("selectDominantImageColor", () => {
  it("prefers saturated cover colors over neutral background pixels", () => {
    const color = selectDominantImageColor(
      pixels([
        [250, 250, 250],
        [248, 248, 248],
        [20, 120, 220],
        [22, 118, 218],
        [24, 121, 221],
      ]),
    );

    expect(color).not.toBeNull();
    expect(color?.b).toBeGreaterThan(color?.r ?? 0);
    expect(color?.b).toBeGreaterThan(color?.g ?? 0);
  });

  it("returns null for transparent or neutral-only art", () => {
    expect(
      selectDominantImageColor(
        pixels([
          [0, 0, 0, 0],
          [230, 230, 230],
          [42, 42, 42],
        ]),
      ),
    ).toBeNull();
  });

  it("equals the first entry of the multi-color palette", () => {
    const px = pixels([...repeat([20, 120, 220], 4), ...repeat([230, 140, 30], 2)]);
    const dominant = selectDominantImageColor(px);
    const palette = selectImagePalette(px, 4);
    expect(palette[0]).toEqual(dominant);
  });
});

describe("selectImagePalette", () => {
  it("returns several distinct chromatic swatches, most dominant first", () => {
    const palette = selectImagePalette(
      pixels([
        ...repeat([248, 248, 248], 4), // neutral bg — filtered out
        ...repeat([20, 120, 220], 6), // blue (dominant)
        ...repeat([230, 140, 30], 4), // orange
        ...repeat([40, 180, 70], 3), // green
      ]),
      4,
    );

    expect(palette).toHaveLength(3);
    // Dominant first: blue (blue channel is the max).
    expect(palette[0].b).toBeGreaterThan(palette[0].r);
    expect(palette[0].b).toBeGreaterThan(palette[0].g);
    // The palette spans the three chromatic clusters.
    expect(palette.some((c) => c.r > c.b && c.r > c.g)).toBe(true); // orange-ish
    expect(palette.some((c) => c.g > c.r && c.g > c.b)).toBe(true); // green-ish
  });

  it("merges near-identical shades into a single swatch", () => {
    const palette = selectImagePalette(
      pixels([
        // five close shades of the same purple
        [120, 40, 200],
        [126, 46, 206],
        [132, 52, 212],
        [138, 58, 218],
        [118, 38, 198],
        // one clearly distinct teal cluster
        ...repeat([20, 180, 180], 4),
      ]),
      4,
    );

    // Despite five purple samples, dedup collapses them to one swatch (+ teal).
    expect(palette).toHaveLength(2);
  });

  it("respects the requested color count", () => {
    const palette = selectImagePalette(
      pixels([
        ...repeat([20, 120, 220], 6), // blue
        ...repeat([220, 40, 40], 5), // red
        ...repeat([40, 180, 70], 4), // green
        ...repeat([230, 200, 30], 3), // yellow
        ...repeat([200, 40, 200], 2), // magenta
      ]),
      3,
    );

    expect(palette).toHaveLength(3);
  });

  it("returns an empty array for transparent or neutral-only art", () => {
    expect(
      selectImagePalette(
        pixels([
          [0, 0, 0, 0],
          [230, 230, 230],
          [42, 42, 42],
        ]),
      ),
    ).toEqual([]);
  });
});
