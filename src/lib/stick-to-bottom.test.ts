import { describe, expect, it } from "vitest";
import { isNearBottom, NEAR_BOTTOM_THRESHOLD } from "./stick-to-bottom";

describe("isNearBottom", () => {
  it("is true when scrolled to the exact bottom", () => {
    expect(isNearBottom({ scrollTop: 400, scrollHeight: 1000, clientHeight: 600 })).toBe(true);
  });

  it("is true within the default slack of the bottom", () => {
    // 40px from bottom (< 80 threshold).
    expect(isNearBottom({ scrollTop: 360, scrollHeight: 1000, clientHeight: 600 })).toBe(true);
  });

  it("is false when scrolled up beyond the threshold", () => {
    // 200px from bottom.
    expect(isNearBottom({ scrollTop: 200, scrollHeight: 1000, clientHeight: 600 })).toBe(false);
  });

  it("treats exactly-threshold as at bottom (inclusive)", () => {
    expect(
      isNearBottom({
        scrollTop: 600 - NEAR_BOTTOM_THRESHOLD,
        scrollHeight: 1200,
        clientHeight: 600,
      }),
    ).toBe(true);
  });

  it("honors a custom threshold", () => {
    const m = { scrollTop: 300, scrollHeight: 1000, clientHeight: 600 }; // 100px from bottom
    expect(isNearBottom(m, 50)).toBe(false);
    expect(isNearBottom(m, 150)).toBe(true);
  });

  it("is true for content shorter than the viewport (nothing to scroll)", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 600 })).toBe(true);
  });
});
