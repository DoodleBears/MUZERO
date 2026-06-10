import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Fakes & controllable inputs ─────────────────────────────────────────────
const { lenisInstances, state } = vi.hoisted(() => ({
  lenisInstances: [] as Array<{ options: { lerp: number }; destroyed: boolean; opts: unknown }>,
  state: { isMac: false, settings: {} as { smoothScroll?: boolean; smoothScrollLerp?: number } },
}));

vi.mock("lenis", () => {
  class FakeLenis {
    options: { lerp: number };
    destroyed = false;
    opts: unknown;
    scrollTo = vi.fn();
    raf = vi.fn();
    constructor(opts: { lerp?: number }) {
      this.opts = opts;
      this.options = { lerp: opts.lerp ?? 0.1 };
      lenisInstances.push(this as never);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { default: FakeLenis };
});

vi.mock("@/lib/shortcuts", () => ({ isMac: () => state.isMac }));
vi.mock("@/hooks/use-app-data", () => ({ useSettings: () => state.settings }));

import { __activeCount, __resetDriver } from "./lenis-driver";
import { useSmoothScroll } from "./use-smooth-scroll";

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: reduced,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

/** Render the hook against a real detached element (with a content child). */
function renderOnElement() {
  const el = document.createElement("div");
  el.appendChild(document.createElement("div")); // content child (virtual-list inner)
  return renderHook(() => {
    const ref = useRef<HTMLDivElement | null>(el);
    return useSmoothScroll(ref);
  });
}

beforeEach(() => {
  lenisInstances.length = 0;
  state.isMac = false;
  state.settings = {};
  stubMatchMedia(false);
  // The hook requires a real-browser env (ResizeObserver). jsdom lacks it, so
  // stub it here — the mocked Lenis ignores it, we just need the guard to pass.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  __resetDriver();
  vi.unstubAllGlobals();
});

describe("useSmoothScroll — lifecycle", () => {
  it("constructs Lenis on the wrapper element when enabled, and registers it", () => {
    state.settings = {}; // undefined pref on non-mac → enabled
    const { result } = renderOnElement();
    expect(lenisInstances).toHaveLength(1);
    expect((lenisInstances[0].opts as { autoRaf?: boolean }).autoRaf).toBe(false);
    expect((lenisInstances[0].opts as { wrapper?: HTMLElement }).wrapper).toBeInstanceOf(
      HTMLElement,
    );
    expect(result.current.lenisRef.current).toBe(lenisInstances[0]);
    expect(__activeCount()).toBe(1);
  });

  it("does NOT construct Lenis when disabled (macOS default)", () => {
    state.isMac = true; // undefined pref on mac → disabled
    const { result } = renderOnElement();
    expect(lenisInstances).toHaveLength(0);
    expect(result.current.lenisRef.current).toBeNull();
    expect(__activeCount()).toBe(0);
  });

  it("does NOT construct Lenis when reduced-motion is on (a11y override)", () => {
    stubMatchMedia(true); // even on non-mac
    const { result } = renderOnElement();
    expect(lenisInstances).toHaveLength(0);
    expect(result.current.lenisRef.current).toBeNull();
  });

  it("destroys + unregisters on unmount", () => {
    const { unmount } = renderOnElement();
    expect(lenisInstances).toHaveLength(1);
    unmount();
    expect(lenisInstances[0].destroyed).toBe(true);
    expect(__activeCount()).toBe(0);
  });
});

describe("useSmoothScroll — reactive settings", () => {
  it("updates lerp IN PLACE without recreating the instance (PRD §5.1)", () => {
    state.settings = { smoothScrollLerp: 0.08 };
    const { rerender } = renderOnElement();
    expect(lenisInstances).toHaveLength(1);
    expect(lenisInstances[0].options.lerp).toBe(0.08);

    state.settings = { smoothScrollLerp: 0.18 };
    act(() => rerender());

    expect(lenisInstances).toHaveLength(1); // not reconstructed
    expect(lenisInstances[0].destroyed).toBe(false);
    expect(lenisInstances[0].options.lerp).toBe(0.18); // mutated in place
  });

  it("destroys the instance when the toggle is turned off", () => {
    const { rerender } = renderOnElement();
    expect(__activeCount()).toBe(1);

    state.settings = { smoothScroll: false };
    act(() => rerender());

    expect(lenisInstances[0].destroyed).toBe(true);
    expect(__activeCount()).toBe(0);
  });

  it("attaches once a conditionally-rendered node appears later (empty→non-empty list)", () => {
    // Start with no node (empty list), then the scroll container mounts.
    const ref: { current: HTMLElement | null } = { current: null };
    const { rerender } = renderHook(() => useSmoothScroll(ref as never));
    expect(lenisInstances).toHaveLength(0); // nothing to attach to yet

    const el = document.createElement("div");
    el.appendChild(document.createElement("div"));
    ref.current = el; // node mounts
    act(() => rerender());

    expect(lenisInstances).toHaveLength(1);
    expect((lenisInstances[0].opts as { wrapper?: HTMLElement }).wrapper).toBe(el);
    expect(__activeCount()).toBe(1);
  });
});
