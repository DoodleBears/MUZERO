import { describe, expect, it } from "vitest";
import { progressPercent, resolveStatusLine } from "./transport";

describe("progressPercent", () => {
  it("maps position/duration to 0–100", () => {
    expect(progressPercent(0, 100)).toBe(0);
    expect(progressPercent(50, 100)).toBe(50);
    expect(progressPercent(100, 100)).toBe(100);
  });

  it("returns 0 for a zero / unknown duration (avoids divide-by-zero)", () => {
    expect(progressPercent(10, 0)).toBe(0);
    expect(progressPercent(10, Number.NaN)).toBe(0);
    expect(progressPercent(10, -5)).toBe(0);
  });

  it("clamps overshoot into [0, 100]", () => {
    expect(progressPercent(150, 100)).toBe(100);
    expect(progressPercent(-10, 100)).toBe(0);
  });
});

describe("resolveStatusLine — error > uploading > generating > none", () => {
  it("returns null when idle", () => {
    expect(
      resolveStatusLine({ isUploading: false, isGenerating: false, djError: null }),
    ).toBeNull();
  });

  it("surfaces an error above everything else", () => {
    expect(resolveStatusLine({ isUploading: true, isGenerating: true, djError: "boom" })).toEqual({
      kind: "error",
      message: "boom",
    });
  });

  it("prefers uploading over generating", () => {
    expect(resolveStatusLine({ isUploading: true, isGenerating: true, djError: null })).toEqual({
      kind: "uploading",
    });
  });

  it("reports generating when only the DJ is busy", () => {
    expect(resolveStatusLine({ isUploading: false, isGenerating: true, djError: null })).toEqual({
      kind: "generating",
    });
  });
});
