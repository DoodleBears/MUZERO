import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLongPress } from "./use-long-press";

function pointer(
  overrides: Partial<{ button: number; clientX: number; clientY: number }> = {},
): ReactPointerEvent {
  return { button: 0, clientX: 0, clientY: 0, ...overrides } as unknown as ReactPointerEvent;
}

describe("useLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires after the hold delay and swallows the trailing click exactly once", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, { delayMs: 500 }));

    act(() => result.current.handlers.onPointerDown(pointer()));
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(500));
    expect(onLongPress).toHaveBeenCalledTimes(1);

    // The click that follows the release is consumed once; later taps pass through.
    expect(result.current.consumeClick()).toBe(true);
    expect(result.current.consumeClick()).toBe(false);
  });

  it("does not fire on a quick tap (release before the delay)", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, { delayMs: 500 }));

    act(() => {
      result.current.handlers.onPointerDown(pointer());
      vi.advanceTimersByTime(200);
      result.current.handlers.onPointerUp();
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
    expect(result.current.consumeClick()).toBe(false);
  });

  it("cancels when the pointer drifts past the move tolerance (scroll/drag)", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useLongPress(onLongPress, { delayMs: 500, moveTolerance: 10 }),
    );

    act(() => {
      result.current.handlers.onPointerDown(pointer());
      result.current.handlers.onPointerMove(pointer({ clientX: 40 }));
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("ignores secondary-button presses so right-click falls through to onContextMenu", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, { delayMs: 500 }));

    act(() => {
      result.current.handlers.onPointerDown(pointer({ button: 2 }));
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("clears a pending timer on unmount", () => {
    const onLongPress = vi.fn();
    const { result, unmount } = renderHook(() => useLongPress(onLongPress, { delayMs: 500 }));

    act(() => result.current.handlers.onPointerDown(pointer()));
    unmount();
    act(() => vi.advanceTimersByTime(500));

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
