import { describe, expect, it } from "vitest";
import { keepDeferredCover } from "./cover-defer";

describe("keepDeferredCover", () => {
  const a = { forKey: "blbA|full", url: "a" };
  const b = { forKey: "blbB|full", url: "b" };

  it("keeps the resolved cover when it is for the SAME cover (no flash during scroll)", () => {
    expect(keepDeferredCover(a, "blbA|full")).toBe(a);
  });

  it("drops it when the row recycled to a DIFFERENT cover (avoid showing the wrong art)", () => {
    expect(keepDeferredCover(b, "blbA|full")).toBeNull();
  });

  it("is null when nothing was resolved yet (a genuinely un-loaded cover → placeholder)", () => {
    expect(keepDeferredCover(null, "blbA|full")).toBeNull();
  });
});
