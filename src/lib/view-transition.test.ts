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

const CHROMIUM_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Electron/28.0.0";
const WEBKIT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/** Swap the engine sniff's UA (canViewTransition reads only `navigator.userAgent`). */
function stubUserAgent(ua: string): void {
  vi.stubGlobal("navigator", { userAgent: ua });
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

  it("is true on a Chromium engine when the API exists and motion is allowed", () => {
    stubStartViewTransition();
    stubReducedMotion(false);
    stubUserAgent(CHROMIUM_UA);
    expect(canViewTransition()).toBe(true);
  });

  it("is false on a WebKit shell even when the API exists (WKWebView flicker)", () => {
    stubStartViewTransition();
    stubReducedMotion(false);
    stubUserAgent(WEBKIT_UA);
    expect(canViewTransition()).toBe(false);
  });

  it("is false when the user prefers reduced motion, even on Chromium", () => {
    stubStartViewTransition();
    stubReducedMotion(true);
    stubUserAgent(CHROMIUM_UA);
    expect(canViewTransition()).toBe(false);
  });
});

describe("startViewTransition", () => {
  it("runs the update exactly once synchronously when unsupported", () => {
    const update = vi.fn();
    startViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("wraps the update in the native API on a Chromium engine", () => {
    stubStartViewTransition((cb) => cb());
    stubReducedMotion(false);
    stubUserAgent(CHROMIUM_UA);
    const update = vi.fn();
    startViewTransition(update);
    expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("bypasses the native API on a WebKit shell (runs update directly)", () => {
    stubStartViewTransition((cb) => cb());
    stubReducedMotion(false);
    stubUserAgent(WEBKIT_UA);
    const update = vi.fn();
    startViewTransition(update);
    expect(doc.startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("bypasses the native API (runs update directly) under reduced motion", () => {
    stubStartViewTransition((cb) => cb());
    stubReducedMotion(true);
    stubUserAgent(CHROMIUM_UA);
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
