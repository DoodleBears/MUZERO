import { describe, expect, it } from "vitest";
import {
  BASE_LENIS_OPTIONS,
  clampLerp,
  LERP_DEFAULT,
  LERP_MAX,
  LERP_MIN,
  resolveSmoothScroll,
} from "./resolve";

const WIN = { isMac: false };
const MAC = { isMac: true };

describe("resolveSmoothScroll — enabled decision (PRD §3.2 truth table)", () => {
  it("undefined preference on non-macOS → disabled (default off)", () => {
    const d = resolveSmoothScroll({ smoothScroll: undefined }, WIN);
    expect(d.preference).toBe(false);
    expect(d.enabled).toBe(false);
  });

  it("undefined preference on macOS → disabled (default off)", () => {
    const d = resolveSmoothScroll({ smoothScroll: undefined }, MAC);
    expect(d.preference).toBe(false);
    expect(d.enabled).toBe(false);
  });

  it("undefined preference remains disabled on non-macOS", () => {
    const d = resolveSmoothScroll({ smoothScroll: undefined }, WIN);
    expect(d.preference).toBe(false);
    expect(d.enabled).toBe(false);
  });

  it("explicit true overrides the platform default → enabled", () => {
    const d = resolveSmoothScroll({ smoothScroll: true }, MAC);
    expect(d.preference).toBe(true);
    expect(d.enabled).toBe(true);
  });

  it("explicit true stays enabled", () => {
    const d = resolveSmoothScroll({ smoothScroll: true }, WIN);
    expect(d.preference).toBe(true);
    expect(d.enabled).toBe(true);
  });

  it("explicit false → disabled regardless of platform / motion", () => {
    expect(resolveSmoothScroll({ smoothScroll: false }, WIN).enabled).toBe(false);
    expect(resolveSmoothScroll({ smoothScroll: false }, MAC).enabled).toBe(false);
  });

  it("keeps the Settings toggle and runtime state aligned", () => {
    const d = resolveSmoothScroll({ smoothScroll: undefined }, WIN);
    expect(d.preference).toBe(false);
    expect(d.enabled).toBe(false);
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
  it("injects the clamped user lerp into Lenis options", () => {
    expect(resolveSmoothScroll({ smoothScrollLerp: 0.06 }, WIN).options.lerp).toBe(0.06);
    expect(resolveSmoothScroll({ smoothScrollLerp: 5 }, WIN).options.lerp).toBe(LERP_MAX);
    expect(resolveSmoothScroll({ smoothScrollLerp: undefined }, WIN).options.lerp).toBe(
      LERP_DEFAULT,
    );
  });

  it("keeps mobile native: syncTouch stays false, wheel stays smooth", () => {
    const { options } = resolveSmoothScroll({}, WIN);
    expect(options.smoothWheel).toBe(true);
    expect(options.syncTouch).toBe(false);
    expect(options.orientation).toBe("vertical");
    expect(BASE_LENIS_OPTIONS.syncTouch).toBe(false);
  });
});
