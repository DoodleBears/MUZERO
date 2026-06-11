import { describe, expect, it } from "vitest";
import {
  buildShuffleOrder,
  clampIndex,
  manualNextIndex,
  nextIndex,
  nextStreamSkipIndex,
  prevIndex,
  shouldAutoExtend,
  shuffleManualNext,
  shuffleNext,
  shufflePrev,
  upcomingCount,
  upcomingManualIndices,
} from "./queue";

describe("upcomingCount", () => {
  it("counts tracks after the current index", () => {
    expect(upcomingCount(5, 0)).toBe(4);
    expect(upcomingCount(5, 4)).toBe(0);
    expect(upcomingCount(5, 2)).toBe(2);
  });
  it("treats empty queue as zero upcoming", () => {
    expect(upcomingCount(0, -1)).toBe(0);
  });
});

describe("shouldAutoExtend (续上歌单 trigger)", () => {
  it("is true when an empty queue needs its first batch", () => {
    expect(shouldAutoExtend(0, -1, 2)).toBe(true);
  });
  it("fires once upcoming falls to/below the threshold", () => {
    // queue of 5, threshold 2 → refill once we're at index 2 (2 upcoming)
    expect(shouldAutoExtend(5, 1, 2)).toBe(false); // 3 upcoming
    expect(shouldAutoExtend(5, 2, 2)).toBe(true); // 2 upcoming
    expect(shouldAutoExtend(5, 4, 2)).toBe(true); // 0 upcoming
  });
  it("threshold 0 only refills on the last track", () => {
    expect(shouldAutoExtend(3, 1, 0)).toBe(false);
    expect(shouldAutoExtend(3, 2, 0)).toBe(true);
  });
});

describe("nextIndex", () => {
  it("advances then stops when repeat is off", () => {
    expect(nextIndex(3, 0, "off")).toBe(1);
    expect(nextIndex(3, 2, "off")).toBeNull();
  });
  it("wraps when repeat is all", () => {
    expect(nextIndex(3, 2, "all")).toBe(0);
  });
  it("stays put when repeat is one", () => {
    expect(nextIndex(3, 1, "one")).toBe(1);
  });
  it("returns 0 from an unset index", () => {
    expect(nextIndex(3, -1, "off")).toBe(0);
  });
  it("returns null for an empty queue", () => {
    expect(nextIndex(0, -1, "all")).toBeNull();
  });
});

describe("manualNextIndex", () => {
  it("ignores repeat-one so the next button still advances", () => {
    expect(manualNextIndex(3, 1, "one")).toBe(2);
  });

  it("wraps from the last track to the first under repeat-one", () => {
    // repeat-one only replays on media-end; the next button still loops the queue.
    expect(manualNextIndex(3, 2, "one")).toBe(0);
  });

  it("keeps repeat-all wrapping for explicit next", () => {
    expect(manualNextIndex(3, 2, "all")).toBe(0);
  });
});

describe("prevIndex", () => {
  it("steps back and clamps at the start", () => {
    expect(prevIndex(3, 2, "off")).toBe(1);
    expect(prevIndex(3, 0, "off")).toBe(0);
  });
  it("wraps to the end when repeat is all", () => {
    expect(prevIndex(3, 0, "all")).toBe(2);
  });
  it("wraps to the end under repeat-one, mirroring manual next", () => {
    expect(prevIndex(3, 0, "one")).toBe(2);
  });
});

describe("clampIndex", () => {
  it("clamps into range and reports -1 when empty", () => {
    expect(clampIndex(3, 5)).toBe(2);
    expect(clampIndex(3, -2)).toBe(0);
    expect(clampIndex(0, 1)).toBe(-1);
  });
});

describe("nextStreamSkipIndex (skip un-streamable songs)", () => {
  it("walks forward, wrapping past the end", () => {
    expect(nextStreamSkipIndex(5, 0, 0, 30)).toBe(1);
    expect(nextStreamSkipIndex(5, 4, 0, 30)).toBe(0); // wrap
  });

  it("stops once it has scanned every other track (no infinite loop)", () => {
    // length 4 → at most 3 skips, then give up.
    expect(nextStreamSkipIndex(4, 0, 2, 30)).toBe(1);
    expect(nextStreamSkipIndex(4, 0, 3, 30)).toBeNull();
  });

  it("respects the maxSkips cap before length", () => {
    expect(nextStreamSkipIndex(100, 0, 30, 30)).toBeNull();
    expect(nextStreamSkipIndex(100, 0, 29, 30)).toBe(1);
  });

  it("returns null for a single-track or empty queue", () => {
    expect(nextStreamSkipIndex(1, 0, 0, 30)).toBeNull();
    expect(nextStreamSkipIndex(0, -1, 0, 30)).toBeNull();
  });
});

describe("buildShuffleOrder", () => {
  it("is a permutation with the current index pinned first", () => {
    // Deterministic rng (always 0) → reverse-ish, then current pinned to front.
    const order = buildShuffleOrder(5, 3, () => 0);
    expect(order).toHaveLength(5);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(order[0]).toBe(3);
  });
});

describe("shuffleNext / shufflePrev", () => {
  const order = [2, 0, 3, 1]; // a fixed shuffled order over length 4

  it("steps forward through the order", () => {
    expect(shuffleNext(order, 4, 2, "off").index).toBe(0);
    expect(shuffleNext(order, 4, 0, "off").index).toBe(3);
    expect(shuffleNext(order, 4, 1, "off").index).toBeNull(); // 1 is last → stop
  });

  it("repeat:one stays on the current track", () => {
    expect(shuffleNext(order, 4, 0, "one").index).toBe(0);
  });

  it("manual shuffled next ignores repeat:one", () => {
    expect(shuffleManualNext(order, 4, 0, "one").index).toBe(3);
  });

  it("manual shuffled next wraps at the cycle end under repeat:one", () => {
    // 1 is last in `order` → repeat-one reshuffles and continues (never null/stuck).
    const res = shuffleManualNext(order, 4, 1, "one");
    expect(res.index).not.toBeNull();
    expect([...res.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("repeat:all reshuffles and continues at the wrap", () => {
    const res = shuffleNext(order, 4, 1, "all"); // 1 is last in order
    expect(res.index).not.toBeNull();
    expect([...res.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]); // fresh permutation
  });

  it("rebuilds a stale order (length mismatch)", () => {
    const res = shuffleNext([0, 1], 4, 0, "off", () => 0);
    expect(res.order).toHaveLength(4);
  });

  it("steps backward, wrapping under repeat:all", () => {
    expect(shufflePrev(order, 4, 0, "off").index).toBe(2); // before 0 is 2
    expect(shufflePrev(order, 4, 2, "off").index).toBe(2); // 2 is first → stay
    expect(shufflePrev(order, 4, 2, "all").index).toBe(1); // wrap to last
    expect(shufflePrev(order, 4, 2, "one").index).toBe(1); // repeat-one wraps too
  });
});

describe("upcomingManualIndices", () => {
  it("previews the next two sequential manual targets", () => {
    expect(
      upcomingManualIndices({
        count: 2,
        currentIndex: 1,
        length: 5,
        repeat: "off",
      }),
    ).toEqual([2, 3]);
  });

  it("stops at the end when repeat is off", () => {
    expect(
      upcomingManualIndices({
        count: 2,
        currentIndex: 3,
        length: 4,
        repeat: "off",
      }),
    ).toEqual([]);
  });

  it("wraps under repeat-all without repeating the current track", () => {
    expect(
      upcomingManualIndices({
        count: 3,
        currentIndex: 2,
        length: 4,
        repeat: "all",
      }),
    ).toEqual([3, 0, 1]);
  });

  it("uses manual-next semantics for repeat-one", () => {
    expect(
      upcomingManualIndices({
        count: 2,
        currentIndex: 1,
        length: 4,
        repeat: "one",
      }),
    ).toEqual([2, 3]);
  });

  it("follows the active shuffle cycle for random playback", () => {
    expect(
      upcomingManualIndices({
        count: 2,
        currentIndex: 0,
        length: 4,
        repeat: "off",
        shuffleOrder: [2, 0, 3, 1],
      }),
    ).toEqual([3, 1]);
  });

  it("wraps the active shuffle cycle for warmup under repeat-all", () => {
    expect(
      upcomingManualIndices({
        count: 2,
        currentIndex: 1,
        length: 4,
        repeat: "all",
        shuffleOrder: [2, 0, 3, 1],
      }),
    ).toEqual([2, 0]);
  });
});
