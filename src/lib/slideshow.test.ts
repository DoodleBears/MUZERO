import { describe, expect, it } from "vitest";
import { nextSlideIndex } from "./slideshow";

describe("nextSlideIndex", () => {
  it("returns 0 for an empty or single-image set", () => {
    expect(nextSlideIndex(0, 0, false)).toBe(0);
    expect(nextSlideIndex(0, 1, false)).toBe(0);
    expect(nextSlideIndex(0, 1, true)).toBe(0);
  });

  it("advances sequentially and wraps", () => {
    expect(nextSlideIndex(0, 3, false)).toBe(1);
    expect(nextSlideIndex(1, 3, false)).toBe(2);
    expect(nextSlideIndex(2, 3, false)).toBe(0);
  });

  it("shuffle never returns the current index (rand swept across [0,1))", () => {
    for (let cur = 0; cur < 5; cur += 1) {
      for (let r = 0; r < 1; r += 0.05) {
        const n = nextSlideIndex(cur, 5, true, () => r);
        expect(n).not.toBe(cur);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(5);
      }
    }
  });

  it("shuffle maps rand uniformly onto the other indices (skipping current)", () => {
    // len 3, current 0 → candidates {1,2}
    expect(nextSlideIndex(0, 3, true, () => 0)).toBe(1);
    expect(nextSlideIndex(0, 3, true, () => 0.99)).toBe(2);
    // current 1 → candidates {0,2}
    expect(nextSlideIndex(1, 3, true, () => 0)).toBe(0);
    expect(nextSlideIndex(1, 3, true, () => 0.99)).toBe(2);
    // current 2 → candidates {0,1}
    expect(nextSlideIndex(2, 3, true, () => 0)).toBe(0);
    expect(nextSlideIndex(2, 3, true, () => 0.99)).toBe(1);
  });

  it("normalizes an out-of-range / negative current before advancing", () => {
    expect(nextSlideIndex(7, 3, false)).toBe(2); // 7 % 3 = 1 → next 2
    expect(nextSlideIndex(-1, 3, false)).toBe(0); // -1 → 2 → next 0
    expect(nextSlideIndex(3, 3, true, () => 0)).toBe(1); // 3 → 0, candidates {1,2}, rand 0 → 1
  });
});
