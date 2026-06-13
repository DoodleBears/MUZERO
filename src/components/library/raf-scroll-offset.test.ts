import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IS_SCROLLING_RESET_DELAY, rafObserveElementOffset } from "./raf-scroll-offset";

// A minimal fake scroll element + Virtualizer instance; we drive scroll + rAF + timers
// by hand so the coalescing is deterministic.
function makeHarness(initialTop = 0) {
  let scrollTop = initialTop;
  const listeners = new Set<() => void>();
  const element = {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(v: number) {
      scrollTop = v;
    },
    scrollLeft: 0,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
  };
  // biome-ignore lint/suspicious/noExplicitAny: minimal stand-in for the Virtualizer instance
  const instance = { scrollElement: element, options: { horizontal: false, isRtl: false } } as any;
  const fireScroll = (top: number) => {
    scrollTop = top;
    for (const fn of listeners) fn();
  };
  return { instance, fireScroll, listenerCount: () => listeners.size };
}

let rafQueue: Array<() => void>;

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
    rafQueue.push(fn);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flushFrame = () => {
  const q = rafQueue;
  rafQueue = [];
  for (const fn of q) fn();
};

describe("rafObserveElementOffset", () => {
  it("emits the initial offset synchronously, not scrolling", () => {
    const { instance } = makeHarness(120);
    const cb = vi.fn();
    rafObserveElementOffset(instance, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(120, false);
  });

  it("coalesces many scroll events into ONE read per frame", () => {
    const { instance, fireScroll } = makeHarness();
    const cb = vi.fn();
    rafObserveElementOffset(instance, cb);
    cb.mockClear();

    // Five wheel-rate events within one frame…
    fireScroll(10);
    fireScroll(20);
    fireScroll(30);
    fireScroll(40);
    fireScroll(50);
    expect(cb).not.toHaveBeenCalled(); // nothing until the frame runs

    flushFrame();
    expect(cb).toHaveBeenCalledTimes(1); // one read, the latest offset
    expect(cb).toHaveBeenLastCalledWith(50, true);
  });

  it("settles isScrolling back to false after the reset delay", () => {
    const { instance, fireScroll } = makeHarness();
    const cb = vi.fn();
    rafObserveElementOffset(instance, cb);
    cb.mockClear();

    fireScroll(64);
    flushFrame();
    expect(cb).toHaveBeenLastCalledWith(64, true);

    vi.advanceTimersByTime(IS_SCROLLING_RESET_DELAY);
    expect(cb).toHaveBeenLastCalledWith(64, false);
  });

  it("removes its listener on cleanup", () => {
    const { instance, listenerCount } = makeHarness();
    const stop = rafObserveElementOffset(instance, vi.fn());
    expect(listenerCount()).toBe(1);
    stop?.();
    expect(listenerCount()).toBe(0);
  });
});
