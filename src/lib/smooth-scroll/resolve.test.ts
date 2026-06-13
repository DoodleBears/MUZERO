import { describe, expect, it } from "vitest";
import {
  BASE_LENIS_OPTIONS,
  clampLerp,
  LERP_DEFAULT,
  LERP_MAX,
  LERP_MIN,
  resolveSmoothScroll,
  WINDOWS_LERP_DEFAULT,
} from "./resolve";

const WINDOWS = { isMac: false, isWindows: true };
const MAC = { isMac: true, isWindows: false };
const LINUX = { isMac: false, isWindows: false };

describe("resolveSmoothScroll — enabled decision", () => {
  it("undefined preference on Windows → ENABLED (default on; native wheel janks heavy lists)", () => {
    const d = resolveSmoothScroll({ smoothScroll: undefined }, WINDOWS);
    expect(d.preference).toBe(true);
    expect(d.enabled).toBe(true);
  });

  it("undefined preference on macOS → disabled (default off)", () => {
    const d = resolveSmoothScroll({ smoothScroll: undefined }, MAC);
    expect(d.preference).toBe(false);
    expect(d.enabled).toBe(false);
  });

  it("undefined preference on Linux → disabled (default off)", () => {
    const d = resolveSmoothScroll({ smoothScroll: undefined }, LINUX);
    expect(d.preference).toBe(false);
    expect(d.enabled).toBe(false);
  });

  it("explicit false overrides the Windows default → disabled (the stored choice wins)", () => {
    const d = resolveSmoothScroll({ smoothScroll: false }, WINDOWS);
    expect(d.preference).toBe(false);
    expect(d.enabled).toBe(false);
  });

  it("explicit true → enabled on any platform", () => {
    expect(resolveSmoothScroll({ smoothScroll: true }, MAC).enabled).toBe(true);
    expect(resolveSmoothScroll({ smoothScroll: true }, LINUX).enabled).toBe(true);
  });
});

describe("clampLerp — strength is user-tunable but bounded (PRD Open Q1)", () => {
  it("undefined / NaN → default 0.10", () => {
    expect(clampLerp(undefined)).toBe(LERP_DEFAULT);
    expect(clampLerp(Number.NaN)).toBe(LERP_DEFAULT);
    expect(LERP_DEFAULT).toBe(0.1);
  });

  it("clamps below/above the safe range", () => {
    expect(clampLerp(0)).toBe(LERP_MIN);
    expect(clampLerp(-5)).toBe(LERP_MIN);
    expect(clampLerp(1)).toBe(LERP_MAX);
    expect(clampLerp(999)).toBe(LERP_MAX);
    expect(LERP_MIN).toBe(0.04);
    expect(LERP_MAX).toBe(0.2);
  });

  it("passes through in-range values unchanged", () => {
    expect(clampLerp(0.08)).toBe(0.08);
    expect(clampLerp(0.15)).toBe(0.15);
  });
});

describe("resolveSmoothScroll — options injection", () => {
  it("injects the clamped user lerp into Lenis options (stored value wins on any platform)", () => {
    expect(resolveSmoothScroll({ smoothScrollLerp: 0.06 }, LINUX).options.lerp).toBe(0.06);
    expect(resolveSmoothScroll({ smoothScrollLerp: 5 }, LINUX).options.lerp).toBe(LERP_MAX);
    expect(resolveSmoothScroll({ smoothScrollLerp: 0.06 }, WINDOWS).options.lerp).toBe(0.06);
  });

  it("defaults the lerp per platform: snappier on Windows, floaty elsewhere", () => {
    expect(resolveSmoothScroll({ smoothScrollLerp: undefined }, LINUX).options.lerp).toBe(
      LERP_DEFAULT,
    );
    expect(resolveSmoothScroll({ smoothScrollLerp: undefined }, MAC).options.lerp).toBe(
      LERP_DEFAULT,
    );
    expect(resolveSmoothScroll({ smoothScrollLerp: undefined }, WINDOWS).options.lerp).toBe(
      WINDOWS_LERP_DEFAULT,
    );
    expect(WINDOWS_LERP_DEFAULT).toBeGreaterThan(LERP_DEFAULT); // snappier = higher
  });

  it("keeps mobile native: syncTouch stays false, wheel stays smooth", () => {
    const { options } = resolveSmoothScroll({}, LINUX);
    expect(options.smoothWheel).toBe(true);
    expect(options.syncTouch).toBe(false);
    expect(options.orientation).toBe("vertical");
    expect(BASE_LENIS_OPTIONS.syncTouch).toBe(false);
  });
});
