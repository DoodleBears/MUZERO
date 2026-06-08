import { afterEach, describe, expect, it, vi } from "vitest";
import { canViewTransition, prefersReducedMotion, startViewTransition } from "./view-transition";

// jsdom has neither `document.startViewTransition` nor `window.matchMedia`, so we
// stub them per-test to exercise each branch of the progressive-enhancement logic.
// lib.dom types `startViewTransition` as non-optional, so reach it through a loose
// shape (cast via unknown) to set/clear it freely in tests.

const doc = document as unknown as { startViewTransition?: (cb: () => void) => unknown };

function stubStartViewTransition(impl?: (cb: () => void) => void): void {
  doc.startViewTransition = vi.fn((cb: () => void) => {
    impl?.(cb);
    return { finished: Promise.resolve(), ready: Promise.resolve() };
  });
}

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduce") ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  doc.startViewTransition = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("canViewTransition", () => {
  it("is false when the native API is absent (jsdom default)", () => {
    expect(canViewTransition()).toBe(false);
  });

  it("stays false when the native API exists and motion is allowed", () => {
    stubStartViewTransition();
    stubReducedMotion(false);
    expect(canViewTransition()).toBe(false);
  });

  it("is false when the user prefers reduced motion, even if the API exists", () => {
    stubStartViewTransition();
    stubReducedMotion(true);
    expect(canViewTransition()).toBe(false);
  });
});

describe("startViewTransition", () => {
  it("runs the update exactly once synchronously when unsupported", () => {
    const update = vi.fn();
    startViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("bypasses document.startViewTransition even when supported", () => {
    stubStartViewTransition((cb) => cb());
    stubReducedMotion(false);
    const update = vi.fn();
    startViewTransition(update);
    expect(doc.startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("bypasses the native API (runs update directly) under reduced motion", () => {
    stubStartViewTransition((cb) => cb());
    stubReducedMotion(true);
    const update = vi.fn();
    startViewTransition(update);
    expect(doc.startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("prefersReducedMotion", () => {
  it("is false when matchMedia is unavailable", () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it("reflects the reduce media query", () => {
    stubReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});
