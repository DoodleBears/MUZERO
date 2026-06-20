import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repaint = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const shell = vi.hoisted(() => ({ hasRepaint: true }));

vi.mock("@/lib/desktop/bridge", () => ({
  resolveDesktopBridge: () => ({
    kind: "electron",
    windowControls: shell.hasRepaint ? { repaint } : {},
  }),
}));

import { useTransparentWindowRepaint } from "./use-transparent-window-repaint";

describe("useTransparentWindowRepaint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    repaint.mockClear();
    shell.hasRepaint = true;
  });
  afterEach(() => vi.useRealTimers());

  it("repaints after the background fades out, clearing the macOS transparent stale frame", () => {
    const { rerender } = renderHook(({ active }) => useTransparentWindowRepaint(active), {
      initialProps: { active: true },
    });

    rerender({ active: false });
    // Not until the fade has settled — repainting mid-fade would re-show the
    // half-faded frame.
    expect(repaint).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1500));
    expect(repaint).toHaveBeenCalled();
  });

  it("uses a shorter settle delay for fast-fading layers (e.g. the control bar)", () => {
    const { rerender } = renderHook(
      ({ active }) => useTransparentWindowRepaint(active, { fadeMs: 200 }),
      { initialProps: { active: true } },
    );

    rerender({ active: false });
    act(() => vi.advanceTimersByTime(120));
    expect(repaint).not.toHaveBeenCalled(); // still within the 200ms fade
    act(() => vi.advanceTimersByTime(200)); // total 320 > 200 + buffer
    expect(repaint).toHaveBeenCalled();
  });

  it("does not repaint when the background appears or stays unchanged", () => {
    const { rerender } = renderHook(({ active }) => useTransparentWindowRepaint(active), {
      initialProps: { active: false },
    });

    rerender({ active: true });
    act(() => vi.advanceTimersByTime(2000));
    expect(repaint).not.toHaveBeenCalled();
  });

  it("no-ops on shells without a repaint capability (web / tauri)", () => {
    shell.hasRepaint = false;
    const { rerender } = renderHook(({ active }) => useTransparentWindowRepaint(active), {
      initialProps: { active: true },
    });

    rerender({ active: false });
    expect(() => act(() => vi.advanceTimersByTime(2000))).not.toThrow();
    expect(repaint).not.toHaveBeenCalled();
  });
});
