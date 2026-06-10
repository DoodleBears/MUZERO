import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTrackSelection } from "./use-track-selection";

const IDS = ["a", "b", "c", "d", "e"];

describe("useTrackSelection", () => {
  it("toggles a single id and tracks count", () => {
    const { result } = renderHook(() => useTrackSelection(IDS));
    act(() => result.current.toggle("b", { index: 1 }));
    expect([...result.current.ids]).toEqual(["b"]);
    act(() => result.current.toggle("b", { index: 1 }));
    expect(result.current.count).toBe(0);
  });

  it("Shift+toggle selects the contiguous range from the anchor (inclusive)", () => {
    const { result } = renderHook(() => useTrackSelection(IDS));
    act(() => result.current.toggle("b", { index: 1 })); // anchor = 1
    act(() => result.current.toggle("d", { index: 3, shiftKey: true }));
    expect([...result.current.ids].sort()).toEqual(["b", "c", "d"]);
  });

  it("ranges work upward too and union with prior selection", () => {
    const { result } = renderHook(() => useTrackSelection(IDS));
    act(() => result.current.toggle("d", { index: 3 })); // anchor = 3
    act(() => result.current.toggle("b", { index: 1, shiftKey: true }));
    expect([...result.current.ids].sort()).toEqual(["b", "c", "d"]);
  });

  it("Shift+toggle with no anchor falls back to a plain toggle", () => {
    const { result } = renderHook(() => useTrackSelection(IDS));
    act(() => result.current.toggle("c", { index: 2, shiftKey: true }));
    expect([...result.current.ids]).toEqual(["c"]);
  });

  it("toggleAll selects all / clears, exit leaves select mode", () => {
    const { result } = renderHook(() => useTrackSelection(IDS));
    act(() => result.current.enter());
    act(() => result.current.toggleAll());
    expect(result.current.allSelected).toBe(true);
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(0);
    act(() => result.current.toggle("a", { index: 0 }));
    act(() => result.current.exit());
    expect(result.current.mode).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it("prunes selected ids that vanish from the list", () => {
    const { result, rerender } = renderHook(({ ids }) => useTrackSelection(ids), {
      initialProps: { ids: IDS },
    });
    act(() => result.current.toggle("d", { index: 3 }));
    rerender({ ids: ["a", "b", "c"] }); // "d" removed (e.g. after a delete)
    expect(result.current.count).toBe(0);
  });
});
