import { describe, expect, it } from "vitest";
import { scrollbarThumb, scrollTopForThumbOffset } from "./scrollbar-thumb";

describe("scrollbarThumb", () => {
  it("is not scrollable when the content fits", () => {
    const t = scrollbarThumb(0, 400, 600, 600);
    expect(t.scrollable).toBe(false);
  });

  it("sizes the thumb by the visible fraction and clamps to a minimum", () => {
    // 600 visible of 2400 → quarter-height thumb of a 600 track = 150.
    expect(scrollbarThumb(0, 2400, 600, 600).size).toBe(150);
    // Tiny visible fraction → clamped to the 24px minimum, not 6px.
    expect(scrollbarThumb(0, 60000, 600, 600).size).toBe(24);
  });

  it("maps scrollTop to a thumb offset (top → 0, bottom → track - size)", () => {
    const track = 600;
    const top = scrollbarThumb(0, 2400, 600, track);
    expect(top.offset).toBe(0);
    const bottom = scrollbarThumb(1800, 2400, 600, track); // maxScroll = 2400-600
    expect(bottom.offset).toBeCloseTo(track - bottom.size); // 600 - 150 = 450
    const mid = scrollbarThumb(900, 2400, 600, track);
    expect(mid.offset).toBeCloseTo((track - mid.size) / 2);
  });
});

describe("scrollTopForThumbOffset", () => {
  it("inverts the thumb offset back to a scrollTop", () => {
    const track = 600;
    const size = scrollbarThumb(0, 2400, 600, track).size; // 150
    expect(scrollTopForThumbOffset(0, 2400, 600, track, size)).toBe(0);
    expect(scrollTopForThumbOffset(track - size, 2400, 600, track, size)).toBeCloseTo(1800);
    expect(scrollTopForThumbOffset((track - size) / 2, 2400, 600, track, size)).toBeCloseTo(900);
  });

  it("clamps an out-of-range drag offset", () => {
    expect(scrollTopForThumbOffset(-50, 2400, 600, 600, 150)).toBe(0);
    expect(scrollTopForThumbOffset(99999, 2400, 600, 600, 150)).toBeCloseTo(1800);
  });
});
