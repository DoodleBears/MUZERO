import { afterEach, describe, expect, it, vi } from "vitest";

// flushSync must run synchronously; mock it to just invoke the callback so the
// test doesn't need a real React render context.
vi.mock("react-dom", () => ({ flushSync: (cb: () => void) => cb() }));

import { transitionState } from "./view-transition-react";

const doc = document as unknown as { startViewTransition?: (cb: () => void) => unknown };

afterEach(() => {
  doc.startViewTransition = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("transitionState", () => {
  it("runs the update once when the native API is absent (jsdom default)", () => {
    const update = vi.fn();
    transitionState(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("drives the update through the native API when supported", () => {
    const startVT = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    doc.startViewTransition = startVT;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const update = vi.fn();
    transitionState(update);
    expect(startVT).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
