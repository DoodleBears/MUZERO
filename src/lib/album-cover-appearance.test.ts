import { describe, expect, it } from "vitest";
import {
  resolveNowPlayingCoverEffectMode,
  shouldRequestCoverBacklightDerivative,
} from "./album-cover-appearance";

describe("shouldRequestCoverBacklightDerivative", () => {
  it("requests only in backlight mode when enabled", () => {
    expect(shouldRequestCoverBacklightDerivative("backlight", true)).toBe(true);
  });

  it("skips the default shadow mode (no per-switch backlight derivative)", () => {
    expect(shouldRequestCoverBacklightDerivative("shadow", true)).toBe(false);
  });

  it("skips the off mode", () => {
    expect(shouldRequestCoverBacklightDerivative("off", true)).toBe(false);
  });

  it("skips when the backlight is not enabled, even in backlight mode", () => {
    expect(shouldRequestCoverBacklightDerivative("backlight", false)).toBe(false);
  });

  it("treats an undefined effect-mode setting as shadow (skips)", () => {
    expect(
      shouldRequestCoverBacklightDerivative(resolveNowPlayingCoverEffectMode(undefined), true),
    ).toBe(false);
  });
});
