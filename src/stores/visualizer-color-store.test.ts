import { describe, expect, it } from "vitest";
import type { Rgb } from "@/lib/visualizer-color";
import { mixPalette } from "./visualizer-color-store";

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });

describe("mixPalette", () => {
  it("returns the source palette at t=0", () => {
    const from = [rgb(0, 0, 0), rgb(10, 20, 30)];
    const to = [rgb(100, 100, 100), rgb(200, 200, 200)];
    expect(mixPalette(from, to, 0)).toEqual(from);
  });

  it("returns the target palette at t=1", () => {
    const from = [rgb(0, 0, 0), rgb(10, 20, 30)];
    const to = [rgb(100, 100, 100), rgb(200, 200, 200)];
    expect(mixPalette(from, to, 1)).toEqual(to);
  });

  it("interpolates each color at the midpoint", () => {
    expect(mixPalette([rgb(0, 0, 0)], [rgb(100, 100, 100)], 0.5)).toEqual([rgb(50, 50, 50)]);
  });

  it("always matches the target length (palette grows)", () => {
    // new palette has 2 colors, old had 1 → fade the new color in from the old last color
    const out = mixPalette([rgb(0, 0, 0)], [rgb(100, 100, 100), rgb(200, 200, 200)], 0);
    expect(out).toHaveLength(2);
    expect(out).toEqual([rgb(0, 0, 0), rgb(0, 0, 0)]);
    expect(mixPalette([rgb(0, 0, 0)], [rgb(100, 100, 100), rgb(200, 200, 200)], 1)).toEqual([
      rgb(100, 100, 100),
      rgb(200, 200, 200),
    ]);
  });

  it("always matches the target length (palette shrinks)", () => {
    const out = mixPalette([rgb(0, 0, 0), rgb(0, 0, 0)], [rgb(100, 100, 100)], 1);
    expect(out).toEqual([rgb(100, 100, 100)]);
  });

  it("fades in from the target when there is no previous palette", () => {
    expect(mixPalette([], [rgb(10, 20, 30)], 0.5)).toEqual([rgb(10, 20, 30)]);
  });

  it("returns an empty palette when the target is empty", () => {
    expect(mixPalette([rgb(1, 2, 3)], [], 0.5)).toEqual([]);
  });
});
