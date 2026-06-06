import { describe, expect, it } from "vitest";
import {
  buildShuffleOrder,
  clampIndex,
  nextIndex,
  prevIndex,
  shouldAutoExtend,
  upcomingCount,
} from "./queue";

describe("upcomingCount", () => {
  it("counts tracks after the current index", () => {
    expect(upcomingCount(5, 0)).toBe(4);
    expect(upcomingCount(5, 4)).toBe(0);
    expect(upcomingCount(5, 2)).toBe(2);
  });
  it("treats empty queue as zero upcoming", () => {
    expect(upcomingCount(0, -1)).toBe(0);
  });
});

describe("shouldAutoExtend (续上歌单 trigger)", () => {
  it("is true when an empty queue needs its first batch", () => {
    expect(shouldAutoExtend(0, -1, 2)).toBe(true);
  });
  it("fires once upcoming falls to/below the threshold", () => {
    // queue of 5, threshold 2 → refill once we're at index 2 (2 upcoming)
    expect(shouldAutoExtend(5, 1, 2)).toBe(false); // 3 upcoming
    expect(shouldAutoExtend(5, 2, 2)).toBe(true); // 2 upcoming
    expect(shouldAutoExtend(5, 4, 2)).toBe(true); // 0 upcoming
  });
  it("threshold 0 only refills on the last track", () => {
    expect(shouldAutoExtend(3, 1, 0)).toBe(false);
    expect(shouldAutoExtend(3, 2, 0)).toBe(true);
  });
});

describe("nextIndex", () => {
  it("advances then stops when repeat is off", () => {
    expect(nextIndex(3, 0, "off")).toBe(1);
    expect(nextIndex(3, 2, "off")).toBeNull();
  });
  it("wraps when repeat is all", () => {
    expect(nextIndex(3, 2, "all")).toBe(0);
  });
  it("stays put when repeat is one", () => {
    expect(nextIndex(3, 1, "one")).toBe(1);
  });
  it("returns 0 from an unset index", () => {
    expect(nextIndex(3, -1, "off")).toBe(0);
  });
  it("returns null for an empty queue", () => {
    expect(nextIndex(0, -1, "all")).toBeNull();
  });
});

describe("prevIndex", () => {
  it("steps back and clamps at the start", () => {
    expect(prevIndex(3, 2, "off")).toBe(1);
    expect(prevIndex(3, 0, "off")).toBe(0);
  });
  it("wraps to the end when repeat is all", () => {
    expect(prevIndex(3, 0, "all")).toBe(2);
  });
});

describe("clampIndex", () => {
  it("clamps into range and reports -1 when empty", () => {
    expect(clampIndex(3, 5)).toBe(2);
    expect(clampIndex(3, -2)).toBe(0);
    expect(clampIndex(0, 1)).toBe(-1);
  });
});

describe("buildShuffleOrder", () => {
  it("is a permutation with the current index pinned first", () => {
    // Deterministic rng (always 0) → reverse-ish, then current pinned to front.
    const order = buildShuffleOrder(5, 3, () => 0);
    expect(order).toHaveLength(5);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(order[0]).toBe(3);
  });
});
