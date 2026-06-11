import { describe, expect, it } from "vitest";
import { scrollTopForRow, topRowIndex } from "./use-list-scroll-preservation";

describe("topRowIndex", () => {
  it("derives the top row index from scroll position (pitch = scrollHeight / count)", () => {
    // 200 rows, 29px pitch → scrollHeight 5800; scrolled to row 150.
    expect(topRowIndex(150 * 29, 5800, 200)).toBe(150);
    expect(topRowIndex(0, 5800, 200)).toBe(0);
  });

  it("returns null when there's nothing to measure", () => {
    expect(topRowIndex(100, 0, 200)).toBeNull(); // not laid out yet
    expect(topRowIndex(100, 5800, 0)).toBeNull(); // empty list
  });
});

describe("scrollTopForRow", () => {
  it("maps a row index back to a scroll offset in a (possibly different) container", () => {
    // Same row 150 in a container with a DIFFERENT pitch (58px) → 200*58 = 11600.
    expect(scrollTopForRow(150, 11600, 200)).toBe(150 * 58);
  });

  it("round-trips a row across two containers of different heights", () => {
    const idx = topRowIndex(150 * 29, 5800, 200); // captured in list A (pitch 29)
    expect(idx).toBe(150);
    expect(scrollTopForRow(idx ?? 0, 11600, 200)).toBe(150 * 58); // restored in list B (pitch 58)
  });

  it("is 0 when the container isn't laid out", () => {
    expect(scrollTopForRow(150, 0, 200)).toBe(0);
  });
});
