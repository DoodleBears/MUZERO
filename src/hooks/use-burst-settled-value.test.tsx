import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBurstSettledValue } from "./use-burst-settled-value";

afterEach(() => {
  vi.useRealTimers();
});

describe("useBurstSettledValue", () => {
  it("returns the initial value immediately", () => {
    const { result } = renderHook(({ v }) => useBurstSettledValue(v, 300), {
      initialProps: { v: "a" },
    });
    expect(result.current).toBe("a");
  });

  it("applies an isolated change instantly (leading edge, no delay)", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useBurstSettledValue(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    // No timer wait needed — a single switch is instant.
    expect(result.current).toBe("b");
  });

  it("keeps slow successive changes instant when spaced past the quiet window", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useBurstSettledValue(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    expect(result.current).toBe("b");
    act(() => vi.advanceTimersByTime(400)); // quiet window elapses
    rerender({ v: "c" });
    expect(result.current).toBe("c"); // next isolated switch is instant again
  });

  it("coalesces a rapid burst: leading value shows, intermediates skipped, final settles", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useBurstSettledValue(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" }); // leading edge → instant
    expect(result.current).toBe("b");
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: "c" }); // mid-burst → held
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: "d" }); // mid-burst → held
    expect(result.current).toBe("b"); // intermediates not applied
    act(() => vi.advanceTimersByTime(300)); // burst goes quiet
    expect(result.current).toBe("d"); // trailing edge lands on the final value
  });

  it("does not re-apply when the burst ends on the leading value", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useBurstSettledValue(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" }); // leading → b
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: "c" }); // held
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: "b" }); // back to the leading value before settle
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe("b");
  });
});
