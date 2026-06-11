import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThrottledValue } from "@/hooks/use-throttled-value";

describe("useThrottledValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial value immediately", () => {
    const { result } = renderHook(({ v }) => useThrottledValue(v, 250), {
      initialProps: { v: "a" },
    });
    expect(result.current).toBe("a");
  });

  it("passes the first change through immediately (leading edge when idle)", () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 250), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    expect(result.current).toBe("b");
  });

  it("coalesces a burst into one trailing emission carrying the latest value", () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 250), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" }); // leading — emits
    rerender({ v: "c" });
    rerender({ v: "d" });
    expect(result.current).toBe("b");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe("d");
  });

  it("never starves under continuous changes (emits at most once per interval, but always eventually)", () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 250), {
      initialProps: { v: 0 },
    });
    // Simulate an import burst: a new array every 50ms, forever.
    let v = 0;
    const seen = new Set<number>([result.current]);
    for (let t = 0; t < 1000; t += 50) {
      rerender({ v: ++v });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      seen.add(result.current);
    }
    // Pure trailing debounce would still show the leading value here; the
    // throttle must have surfaced intermediate progress (≈1 per 250ms).
    expect(seen.size).toBeGreaterThanOrEqual(4);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe(v); // trailing emission lands on the latest
  });

  it("cancels the pending trailing emission on unmount", () => {
    const { result, rerender, unmount } = renderHook(({ v }) => useThrottledValue(v, 250), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    rerender({ v: "c" });
    expect(result.current).toBe("b");
    unmount();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // No state update after unmount (React would warn / throw in strict envs).
  });
});
