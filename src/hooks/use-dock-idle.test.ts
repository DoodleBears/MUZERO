import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDockIdle } from "./use-dock-idle";

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function movePointer(clientY: number) {
  window.dispatchEvent(new MouseEvent("pointermove", { clientY }));
}

describe("useDockIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("on wide pointer screens only reveals from the bottom hot zone", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useDockIdle(true, 100, 120));

    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(true);

    act(() => movePointer(200));
    expect(result.current).toBe(true);

    act(() => movePointer(760));
    expect(result.current).toBe(false);

    act(() => {
      movePointer(200);
      vi.advanceTimersByTime(99);
    });
    expect(result.current).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("on narrow or touch screens preserves the old any-activity reveal behavior", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useDockIdle(true, 100, 120));

    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(true);

    act(() => movePointer(200));
    expect(result.current).toBe(false);

    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(true);
  });
});
