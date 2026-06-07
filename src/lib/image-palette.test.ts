import { describe, expect, it } from "vitest";
import { selectDominantImageColor } from "./image-palette";

function pixels(colors: Array<[number, number, number, number?]>): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
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
});
