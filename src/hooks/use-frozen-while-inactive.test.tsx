import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFrozenWhileInactive } from "./use-frozen-while-inactive";

describe("useFrozenWhileInactive", () => {
  it("returns the live value while active", () => {
    const { result, rerender } = renderHook(
      ({ value, active }) => useFrozenWhileInactive(value, active),
      { initialProps: { value: "a", active: true } },
    );
    expect(result.current).toBe("a");
    rerender({ value: "b", active: true });
    expect(result.current).toBe("b");
  });

  it("freezes the last active value when inactive — a value change is ignored", () => {
    const { result, rerender } = renderHook(
      ({ value, active }) => useFrozenWhileInactive(value, active),
      { initialProps: { value: "a", active: true } },
    );
    // go inactive at "a"
    rerender({ value: "a", active: false });
    expect(result.current).toBe("a");
    // value changes while inactive (a track write) → frozen, not "b"
    rerender({ value: "b", active: false });
    expect(result.current).toBe("a");
    rerender({ value: "c", active: false });
    expect(result.current).toBe("a");
  });

  it("flushes the latest value once the surface becomes active again", async () => {
    const { result, rerender } = renderHook(
      ({ value, active }) => useFrozenWhileInactive(value, active),
      { initialProps: { value: "a", active: false } },
    );
    rerender({ value: "z", active: false });
    expect(result.current).toBe("a"); // still frozen
    await act(async () => {
      rerender({ value: "z", active: true });
    });
    expect(result.current).toBe("z"); // live again
  });

  it("with a resync delay, trailing-debounces the inactive value instead of hard-freezing", () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(
        ({ value, active }) => useFrozenWhileInactive(value, active, 2000),
        { initialProps: { value: "a", active: true } },
      );
      act(() => {
        rerender({ value: "a", active: false });
      });
      expect(result.current).toBe("a");
      // Two edits inside the debounce window — each reschedules, none lands yet.
      act(() => {
        rerender({ value: "b", active: false });
        vi.advanceTimersByTime(1500);
      });
      expect(result.current).toBe("a");
      act(() => {
        rerender({ value: "c", active: false });
        vi.advanceTimersByTime(1500);
      });
      expect(result.current).toBe("a"); // still within the window after the latest edit
      // Quiet for the full delay → resync to the LATEST value.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current).toBe("c");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves referential stability of the frozen value across inactive renders", () => {
    const a = { n: 1 };
    const b = { n: 2 };
    const { result, rerender } = renderHook(
      ({ value, active }) => useFrozenWhileInactive(value, active),
      { initialProps: { value: a, active: true } },
    );
    rerender({ value: a, active: false });
    const frozen = result.current;
    rerender({ value: b, active: false }); // new ref arrives while inactive
    expect(result.current).toBe(frozen); // same ref → memos keyed on it don't recompute
  });
});
