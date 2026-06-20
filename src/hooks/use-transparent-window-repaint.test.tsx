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

import {
  useContinuousTransparentRepaint,
  useTransparentWindowRepaint,
} from "./use-transparent-window-repaint";

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

describe("useContinuousTransparentRepaint", () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    repaint.mockClear();
    shell.hasRepaint = true;
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Drain queued rAF callbacks (each re-queues the next frame).
  const tick = (n: number) => {
    for (let i = 0; i < n; i += 1) {
      const cb = frames.shift();
      cb?.(performance.now());
    }
  };

  it("repaints every animation frame while active (clears the unfocused window)", () => {
    renderHook(() => useContinuousTransparentRepaint(true));
    tick(3);
    expect(repaint.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not run while inactive", () => {
    renderHook(() => useContinuousTransparentRepaint(false));
    tick(3);
    expect(repaint).not.toHaveBeenCalled();
  });

  it("stops repainting after it goes inactive", () => {
    const { rerender } = renderHook(({ active }) => useContinuousTransparentRepaint(active), {
      initialProps: { active: true },
    });
    tick(1);
    const callsWhileActive = repaint.mock.calls.length;
    rerender({ active: false });
    tick(3);
    expect(repaint.mock.calls.length).toBe(callsWhileActive);
  });

  it("no-ops on shells without a repaint capability", () => {
    shell.hasRepaint = false;
    renderHook(() => useContinuousTransparentRepaint(true));
    expect(() => tick(3)).not.toThrow();
    expect(repaint).not.toHaveBeenCalled();
  });
});
