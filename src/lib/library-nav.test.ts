import { describe, expect, it } from "vitest";
import { accumulateBackSwipe, rovingIndex } from "./library-nav";

describe("rovingIndex", () => {
  it("first prev/next press lands on the fallback when nothing is focused", () => {
    expect(rovingIndex(5, -1, "next")).toBe(0);
    expect(rovingIndex(5, -1, "prev")).toBe(0);
    expect(rovingIndex(5, -1, "next", 3)).toBe(3);
  });

  it("steps by one and clamps at both ends (no wrap)", () => {
    expect(rovingIndex(5, 2, "next")).toBe(3);
    expect(rovingIndex(5, 2, "prev")).toBe(1);
    expect(rovingIndex(5, 4, "next")).toBe(4);
    expect(rovingIndex(5, 0, "prev")).toBe(0);
  });

  it("clamps an out-of-range fallback and returns -1 for an empty list", () => {
    expect(rovingIndex(3, -1, "next", 99)).toBe(2);
    expect(rovingIndex(0, -1, "next")).toBe(-1);
  });
});

describe("accumulateBackSwipe", () => {
  it("accumulates a sustained horizontal left→right (negative deltaX) swipe", () => {
    let acc = 0;
    acc = accumulateBackSwipe(acc, -40, 2);
    acc = accumulateBackSwipe(acc, -50, -3);
    expect(acc).toBe(-90);
  });

  it("cancels on a vertical-dominant delta", () => {
    expect(accumulateBackSwipe(-80, -10, 30)).toBe(0);
  });

  it("cancels on a forward (rightward) delta", () => {
    expect(accumulateBackSwipe(-80, 40, 1)).toBe(0);
  });
});
