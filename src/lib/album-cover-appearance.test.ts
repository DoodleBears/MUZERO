import { describe, expect, it } from "vitest";
import {
  albumCoverAppearanceCssVars,
  resolveNowPlayingCoverBacklightAppearance,
  resolveNowPlayingCoverEffectMode,
  shouldRequestCoverBacklightDerivative,
} from "./album-cover-appearance";

describe("resolveNowPlayingCoverBacklightAppearance", () => {
  it("uses the tuned backlight defaults", () => {
    expect(resolveNowPlayingCoverBacklightAppearance({})).toEqual({
      blur: 12,
      opacity: 50,
      range: 13,
      saturation: 330,
    });
    expect(albumCoverAppearanceCssVars({})).toMatchObject({
      "--now-playing-cover-backlight-blur": "12px",
      "--now-playing-cover-backlight-opacity": "0.5",
      "--now-playing-cover-backlight-saturation": "330%",
      "--now-playing-cover-backlight-scale": "1.13",
    });
  });
});

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
