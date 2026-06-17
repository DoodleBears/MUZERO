import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CoverWindowSlot,
  clearCoverWindow,
  coverWindowOffset,
  getCoverWindow,
  setCoverWindow,
  subscribeWindow,
} from "./cover-window-store";

const slot = (offsetSteps: number, trackId: string, coverUrl: string | null): CoverWindowSlot => ({
  offsetSteps,
  trackId,
  coverUrl,
});

describe("cover-window-store", () => {
  afterEach(() => {
    clearCoverWindow();
  });

  it("publishes window content and notifies subscribers", () => {
    const seen = vi.fn();
    const unsub = subscribeWindow(seen);
    setCoverWindow({ active: true, slots: [slot(0, "trk_a", "a.jpg")] });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(getCoverWindow().active).toBe(true);
    expect(getCoverWindow().slots).toEqual([slot(0, "trk_a", "a.jpg")]);
    unsub();
  });

  it("does NOT notify when the content is unchanged (no churn)", () => {
    setCoverWindow({ active: true, slots: [slot(0, "trk_a", "a.jpg")] });
    const seen = vi.fn();
    const unsub = subscribeWindow(seen);
    setCoverWindow({ active: true, slots: [slot(0, "trk_a", "a.jpg")] });
    expect(seen).not.toHaveBeenCalled();
    // A real change (cover resolved) does notify.
    setCoverWindow({ active: true, slots: [slot(0, "trk_a", "a-final.jpg")] });
    expect(seen).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("clearCoverWindow resets to idle and zeroes the offset", () => {
    setCoverWindow({ active: true, slots: [slot(0, "trk_a", "a.jpg")] });
    coverWindowOffset.set(-0.5);
    clearCoverWindow();
    expect(getCoverWindow().active).toBe(false);
    expect(getCoverWindow().slots).toEqual([]);
    expect(coverWindowOffset.get()).toBe(0);
  });
});
