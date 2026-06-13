import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Fakes & controllable inputs ─────────────────────────────────────────────
const { lenisInstances, state } = vi.hoisted(() => ({
  lenisInstances: [] as Array<{
    options: { lerp: number };
    destroyed: boolean;
    opts: unknown;
    resize: ReturnType<typeof vi.fn>;
  }>,
  state: {
    isMac: false,
    isWindows: false,
    settings: {} as { smoothScroll?: boolean; smoothScrollLerp?: number },
  },
}));

vi.mock("lenis", () => {
  class FakeLenis {
    options: { lerp: number };
    destroyed = false;
    opts: unknown;
    scrollTo = vi.fn();
    raf = vi.fn();
    resize = vi.fn();
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

vi.mock("@/lib/shortcuts", () => ({
  isMac: () => state.isMac,
  isWindows: () => state.isWindows,
}));
vi.mock("@/hooks/use-app-data", () => ({ useSettings: () => state.settings }));

import { __activeCount, __resetDriver } from "./lenis-driver";
import { useSmoothScroll } from "./use-smooth-scroll";

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
    state.settings = { smoothScroll: true };
    const { result } = renderOnElement();
    expect(lenisInstances).toHaveLength(1);
    expect((lenisInstances[0].opts as { autoRaf?: boolean }).autoRaf).toBe(false);
    expect((lenisInstances[0].opts as { wrapper?: HTMLElement }).wrapper).toBeInstanceOf(
      HTMLElement,
    );
    expect((lenisInstances[0].opts as { content?: HTMLElement }).content).toBe(
      (lenisInstances[0].opts as { wrapper?: HTMLElement }).wrapper,
    );
    expect(result.current.lenisRef.current).toBe(lenisInstances[0]);
    expect(__activeCount()).toBe(1);
  });

  it("does NOT construct Lenis when unset (default off)", () => {
    state.isMac = false;
    const { result } = renderOnElement();
    expect(lenisInstances).toHaveLength(0);
    expect(result.current.lenisRef.current).toBeNull();
    expect(__activeCount()).toBe(0);
  });

  it("constructs Lenis when explicitly enabled", () => {
    state.settings = { smoothScroll: true };
    const { result } = renderOnElement();
    expect(lenisInstances).toHaveLength(1);
    expect(result.current.lenisRef.current).toBe(lenisInstances[0]);
  });

  it("destroys + unregisters on unmount", () => {
    state.settings = { smoothScroll: true };
    const { unmount } = renderOnElement();
    expect(lenisInstances).toHaveLength(1);
    unmount();
    expect(lenisInstances[0].destroyed).toBe(true);
    expect(__activeCount()).toBe(0);
  });

  it("re-measures Lenis when the column's content grows (the can't-scroll-down fix)", async () => {
    state.settings = { smoothScroll: true };
    // Render against a real element so the MutationObserver fires; capture it.
    const el = document.createElement("div");
    el.appendChild(document.createElement("div"));
    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement | null>(el);
      return useSmoothScroll(ref);
    });
    const lenis = lenisInstances[0];
    // Measured once on attach (a fresh column needs its initial limit).
    expect(lenis.resize).toHaveBeenCalled();

    lenis.resize.mockClear();
    // Content appears later (lyrics / DJ console / async cover) → re-measure so the
    // new height is scrollable instead of clamped to the old, shorter limit.
    await act(async () => {
      el.appendChild(document.createElement("div"));
      await Promise.resolve(); // flush the MutationObserver microtask
    });
    expect(lenis.resize).toHaveBeenCalled();
    unmount();
  });
});

describe("useSmoothScroll — reactive settings", () => {
  it("updates lerp IN PLACE without recreating the instance (PRD §5.1)", () => {
    state.settings = { smoothScroll: true, smoothScrollLerp: 0.08 };
    const { rerender } = renderOnElement();
    expect(lenisInstances).toHaveLength(1);
    expect(lenisInstances[0].options.lerp).toBe(0.08);

    state.settings = { smoothScroll: true, smoothScrollLerp: 0.18 };
    act(() => rerender());

    expect(lenisInstances).toHaveLength(1); // not reconstructed
    expect(lenisInstances[0].destroyed).toBe(false);
    expect(lenisInstances[0].options.lerp).toBe(0.18); // mutated in place
  });

  it("destroys the instance when the toggle is turned off", () => {
    state.settings = { smoothScroll: true };
    const { rerender } = renderOnElement();
    expect(__activeCount()).toBe(1);

    state.settings = { smoothScroll: false };
    act(() => rerender());

    expect(lenisInstances[0].destroyed).toBe(true);
    expect(__activeCount()).toBe(0);
  });

  it("attaches once a conditionally-rendered node appears later (empty→non-empty list)", () => {
    // Start with no node (empty list), then the scroll container mounts.
    state.settings = { smoothScroll: true };
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
