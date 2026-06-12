import { afterEach, describe, expect, it, vi } from "vitest";
import { canViewTransition, startViewTransition } from "./view-transition";

// jsdom has no `document.startViewTransition`, so we stub it per-test to exercise
// each branch of the progressive-enhancement logic.
// lib.dom types `startViewTransition` as non-optional, so reach it through a loose
// shape (cast via unknown) to set/clear it freely in tests.

const doc = document as unknown as { startViewTransition?: (cb: () => void) => unknown };

function stubStartViewTransition(impl?: (cb: () => void) => void): void {
  doc.startViewTransition = vi.fn((cb: () => void) => {
    impl?.(cb);
    return { finished: Promise.resolve(), ready: Promise.resolve() };
  });
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

  it("is true on a Chromium engine when the API exists", () => {
    stubStartViewTransition();
    stubUserAgent(CHROMIUM_UA);
    expect(canViewTransition()).toBe(true);
  });

  it("is false on a WebKit shell even when the API exists (WKWebView flicker)", () => {
    stubStartViewTransition();
    stubUserAgent(WEBKIT_UA);
    expect(canViewTransition()).toBe(false);
  });

  it("ignores reduced-motion preferences on Chromium", () => {
    stubStartViewTransition();
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("reduce"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    stubUserAgent(CHROMIUM_UA);
    expect(canViewTransition()).toBe(true);
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
    stubUserAgent(CHROMIUM_UA);
    const update = vi.fn();
    startViewTransition(update);
    expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("bypasses the native API on a WebKit shell (runs update directly)", () => {
    stubStartViewTransition((cb) => cb());
    stubUserAgent(WEBKIT_UA);
    const update = vi.fn();
    startViewTransition(update);
    expect(doc.startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("wraps the update in the native API under reduced motion on Chromium", () => {
    stubStartViewTransition((cb) => cb());
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("reduce"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    stubUserAgent(CHROMIUM_UA);
    const update = vi.fn();
    startViewTransition(update);
    expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
