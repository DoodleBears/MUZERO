import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSettledValue } from "./use-settled-value";

afterEach(() => {
  vi.useRealTimers();
});

describe("useSettledValue", () => {
  it("returns the initial value immediately (no startup delay)", () => {
    const { result } = renderHook(({ v }) => useSettledValue(v, 200), {
      initialProps: { v: "a" },
    });
    expect(result.current).toBe("a");
  });

  it("adopts a new value only after it has been stable for delayMs", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useSettledValue(v, 200), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(199));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("b");
  });

  it("skips intermediate values during a rapid burst (only the final settles)", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useSettledValue(v, 200), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: "c" });
    // 100ms after "c" — "b" never settled, still showing "a".
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("a");
    // "c" now stable for the full 200ms.
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("c");
  });

  it("cancels a pending change if the value returns to the settled one", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useSettledValue(v, 200), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: "a" });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("a");
  });
});
