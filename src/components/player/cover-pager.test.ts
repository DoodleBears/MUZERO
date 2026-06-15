import { describe, expect, it } from "vitest";
import {
  applyPagerSettle,
  assignPagerSlots,
  type PagerSlot,
  pagerTranslate,
  resolvePagerSettle,
  slotRestOffsetPx,
} from "./cover-pager";

const byKey = (slots: PagerSlot[]) => Object.fromEntries(slots.map((s) => [s.slotKey, s]));

describe("assignPagerSlots", () => {
  it("builds 2*radius+1 slots with stable, center-independent slotKeys", () => {
    const a = assignPagerSlots(5, 100, 2);
    const b = assignPagerSlots(6, 100, 2);
    expect(a.map((s) => s.slotKey)).toEqual([0, 1, 2, 3, 4]);
    // slotKey identity (and its offsetSteps) never shift with the center → the
    // DOM node for a given slotKey is reused, only its queueIndex content rotates.
    expect(a.map((s) => s.offsetSteps)).toEqual(b.map((s) => s.offsetSteps));
    expect(a.map((s) => s.offsetSteps)).toEqual([-2, -1, 0, 1, 2]);
    // Center slot is the middle slotKey (radius), always.
    expect(byKey(a)[2].offsetSteps).toBe(0);
    expect(byKey(a)[2].queueIndex).toBe(5);
    expect(byKey(b)[2].queueIndex).toBe(6);
  });

  it("maps each slot to centerIndex + offsetSteps when in range", () => {
    const slots = assignPagerSlots(5, 100, 2);
    expect(slots.map((s) => s.queueIndex)).toEqual([3, 4, 5, 6, 7]);
  });

  it("nulls slots past the start of the queue", () => {
    const slots = assignPagerSlots(0, 10, 2);
    expect(slots.map((s) => s.queueIndex)).toEqual([null, null, 0, 1, 2]);
  });

  it("nulls slots past the end of the queue", () => {
    const slots = assignPagerSlots(9, 10, 2);
    expect(slots.map((s) => s.queueIndex)).toEqual([7, 8, 9, null, null]);
  });

  it("handles a single-item queue (only center is filled)", () => {
    const slots = assignPagerSlots(0, 1, 2);
    expect(slots.map((s) => s.queueIndex)).toEqual([null, null, 0, null, null]);
  });

  it("nulls every slot for an empty queue or no current track", () => {
    expect(assignPagerSlots(0, 0, 2).every((s) => s.queueIndex === null)).toBe(true);
    expect(assignPagerSlots(-1, 10, 2).every((s) => s.queueIndex === null)).toBe(true);
  });

  it("supports radius 0 (a single center slot)", () => {
    const slots = assignPagerSlots(4, 10, 0);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ slotKey: 0, offsetSteps: 0, queueIndex: 4 });
  });
});

describe("pagerTranslate / slotRestOffsetPx", () => {
  it("translates the whole strip by drag * gain", () => {
    expect(pagerTranslate(-40, 1)).toBe(-40);
    expect(pagerTranslate(-40, 1.5)).toBe(-60);
    expect(pagerTranslate(0, 2)).toBe(0);
  });

  it("places a slot at its rest position = offsetSteps * width", () => {
    expect(slotRestOffsetPx(0, 300)).toBe(0);
    expect(slotRestOffsetPx(-2, 300)).toBe(-600);
    expect(slotRestOffsetPx(1, 300)).toBe(300);
  });
});

describe("resolvePagerSettle", () => {
  it("commits to next when dragged left past the threshold (negative x)", () => {
    expect(resolvePagerSettle(-30, 100, 0.25)).toBe(1);
    expect(resolvePagerSettle(-25, 100, 0.25)).toBe(1);
  });

  it("commits to prev when dragged right past the threshold (positive x)", () => {
    expect(resolvePagerSettle(30, 100, 0.25)).toBe(-1);
  });

  it("snaps back to center when under the threshold", () => {
    expect(resolvePagerSettle(-10, 100, 0.25)).toBe(0);
    expect(resolvePagerSettle(10, 100, 0.25)).toBe(0);
    expect(resolvePagerSettle(0, 100, 0.25)).toBe(0);
  });

  it("never commits when width is unknown", () => {
    expect(resolvePagerSettle(-9999, 0, 0.25)).toBe(0);
  });
});

describe("applyPagerSettle", () => {
  it("applies the delta clamped to the queue bounds", () => {
    expect(applyPagerSettle(5, 1, 10)).toBe(6);
    expect(applyPagerSettle(5, -1, 10)).toBe(4);
    expect(applyPagerSettle(9, 1, 10)).toBe(9); // clamped at end
    expect(applyPagerSettle(0, -1, 10)).toBe(0); // clamped at start
  });

  it("is a no-op for an empty queue", () => {
    expect(applyPagerSettle(0, 1, 0)).toBe(0);
  });
});
