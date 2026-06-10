import { describe, expect, it } from "vitest";
import {
  orderedSetTrackIds,
  planReorder,
  RANK_SPACING,
  rankAfter,
  rankBefore,
  rankBetween,
  ranksAtBottom,
  ranksAtTop,
  ranksForBlock,
  rebalance,
} from "./set-order";

// Two consecutive doubles: (a + b) / 2 has no representable value strictly
// between them, so rankBetween must report "no room" (epsilon condition).
const ADJACENT_A = 1;
const ADJACENT_B = 1 + Number.EPSILON;

describe("rankBetween", () => {
  it("returns the midpoint of two ranks", () => {
    expect(rankBetween(0, RANK_SPACING)).toBe(512);
    expect(rankBetween(0, 1)).toBe(0.5);
    expect(rankBetween(-1024, 0)).toBe(-512);
  });

  it("returns null when the float gap is exhausted (epsilon hit)", () => {
    expect(rankBetween(ADJACENT_A, ADJACENT_B)).toBeNull();
  });
});

describe("rankBefore / rankAfter", () => {
  it("extends outward by RANK_SPACING and never needs a rebalance", () => {
    expect(rankBefore(0)).toBe(-RANK_SPACING);
    expect(rankAfter(3072)).toBe(3072 + RANK_SPACING);
  });

  it("allows negative ranks (repeated drag-to-top)", () => {
    let min = 0;
    for (let i = 0; i < 5; i++) min = rankBefore(min);
    expect(min).toBe(-5 * RANK_SPACING);
    expect(min).toBeLessThan(0);
  });
});

describe("ranksForBlock", () => {
  it("evenly spaces K strictly-increasing ranks inside (a, b)", () => {
    expect(ranksForBlock(0, RANK_SPACING, 3)).toEqual([256, 512, 768]);
    const r = ranksForBlock(0, RANK_SPACING, 3)!;
    expect(r[0]).toBeGreaterThan(0);
    expect(r[2]).toBeLessThan(RANK_SPACING);
    expect(r[0]).toBeLessThan(r[1]);
    expect(r[1]).toBeLessThan(r[2]);
  });

  it("returns null when the gap can't hold K distinct doubles", () => {
    expect(ranksForBlock(ADJACENT_A, ADJACENT_B, 1)).toBeNull();
    // Only a few ULPs wide (at magnitude 1) → can't fit many distinct doubles.
    expect(ranksForBlock(1, 1 + Number.EPSILON, 5)).toBeNull();
    expect(ranksForBlock(1, 1 + 4 * Number.EPSILON, 10)).toBeNull();
  });

  it("room depends on ULPs, not absolute gap (a tiny gap can still hold many)", () => {
    // Near 1e-12 the ULP is ~1e-28, so a 1e-12 gap holds 100 distinct ranks fine.
    // This is why the design uses an exact float test, not a fixed absolute epsilon.
    expect(ranksForBlock(0, 1e-12, 100)).not.toBeNull();
  });
});

describe("ranksAtTop / ranksAtBottom", () => {
  it("places K increasing ranks below belowRank", () => {
    expect(ranksAtTop(0, 3)).toEqual([-3072, -2048, -1024]);
    const r = ranksAtTop(0, 3);
    expect(Math.max(...r)).toBeLessThan(0);
  });

  it("places K increasing ranks above aboveRank", () => {
    expect(ranksAtBottom(0, 3)).toEqual([1024, 2048, 3072]);
    const r = ranksAtBottom(0, 3);
    expect(Math.min(...r)).toBeGreaterThan(0);
  });
});

describe("rebalance", () => {
  it("assigns evenly-spaced integer ranks in order", () => {
    expect(rebalance(["a", "b", "c"])).toEqual({ a: 0, b: 1024, c: 2048 });
  });

  it("is idempotent on an already-balanced order", () => {
    const once = rebalance(["a", "b", "c"]);
    const ordered = orderedSetTrackIds(["a", "b", "c"], once);
    expect(rebalance(ordered)).toEqual(once);
  });
});

describe("orderedSetTrackIds", () => {
  it("returns trackIds unchanged when no ranks (legacy set)", () => {
    expect(orderedSetTrackIds(["a", "b", "c"], undefined)).toEqual(["a", "b", "c"]);
    expect(orderedSetTrackIds(["a", "b", "c"], {})).toEqual(["a", "b", "c"]);
  });

  it("sorts by rank ascending", () => {
    expect(orderedSetTrackIds(["a", "b", "c"], { a: 2048, b: 0, c: 1024 })).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("is a stable sort (ties keep array order)", () => {
    expect(orderedSetTrackIds(["a", "b", "c"], { a: 0, b: 0, c: 0 })).toEqual(["a", "b", "c"]);
  });

  it("tiebreaks missing ranks to the end in array order (defensive)", () => {
    expect(orderedSetTrackIds(["a", "b", "c"], { b: 10 })).toEqual(["b", "a", "c"]);
  });
});

describe("planReorder — materialized set", () => {
  const trackIds = ["a", "b", "c", "d"];
  const ranks = { a: 0, b: 1024, c: 2048, d: 3072 };

  it("drag-to-top: block goes below the current minimum (rank may be negative)", () => {
    const plan = planReorder(trackIds, ranks, ["c"], "a");
    expect(plan.noop).toBe(false);
    expect(plan.rebalanced).toBe(false);
    expect(plan.ranks.c).toBe(-1024);
    expect(plan.changed).toEqual([{ trackId: "c", rank: -1024 }]);
    expect(orderedSetTrackIds(trackIds, plan.ranks)).toEqual(["c", "a", "b", "d"]);
  });

  it("drag-to-end: block goes above the current maximum", () => {
    const plan = planReorder(trackIds, ranks, ["a"], null);
    expect(plan.ranks.a).toBe(4096);
    expect(plan.changed).toEqual([{ trackId: "a", rank: 4096 }]);
    expect(orderedSetTrackIds(trackIds, plan.ranks)).toEqual(["b", "c", "d", "a"]);
  });

  it("drag-to-middle: block takes the midpoint between neighbors", () => {
    const plan = planReorder(trackIds, ranks, ["a"], "c");
    expect(plan.ranks.a).toBe(1536);
    expect(orderedSetTrackIds(trackIds, plan.ranks)).toEqual(["b", "a", "c", "d"]);
  });

  it("block move keeps the selection's relative order as one contiguous block", () => {
    // Selection {c, a} (passed unordered) dragged to the top, before "b".
    const plan = planReorder(trackIds, ranks, ["c", "a"], "b");
    expect(plan.rebalanced).toBe(false);
    expect(plan.ranks.a).toBe(-1024);
    expect(plan.ranks.c).toBe(0);
    expect(orderedSetTrackIds(trackIds, plan.ranks)).toEqual(["a", "c", "b", "d"]);
  });

  it("no-op when dropped back at the same position", () => {
    const plan = planReorder(trackIds, ranks, ["a"], "b");
    expect(plan.noop).toBe(true);
    expect(plan.changed).toEqual([]);
  });

  it("no-op when the whole set is moved (order can't change)", () => {
    const plan = planReorder(trackIds, ranks, ["a", "b", "c", "d"], null);
    expect(plan.noop).toBe(true);
  });

  it("defensive no-op when the anchor is part of the moving block", () => {
    const plan = planReorder(trackIds, ranks, ["a"], "a");
    expect(plan.noop).toBe(true);
  });
});

describe("planReorder — lazy materialization (unmaterialized set)", () => {
  it("first reorder materializes the FINAL order and carries all ranks", () => {
    const plan = planReorder(["a", "b", "c"], undefined, ["c"], "a");
    expect(plan.noop).toBe(false);
    expect(plan.rebalanced).toBe(true);
    expect(plan.ranks).toEqual({ c: 0, a: 1024, b: 2048 });
    expect(plan.changed).toEqual([
      { trackId: "c", rank: 0 },
      { trackId: "a", rank: 1024 },
      { trackId: "b", rank: 2048 },
    ]);
  });

  it("no-op (no write) when an unmaterialized set is dropped in place", () => {
    const plan = planReorder(["a", "b", "c"], undefined, ["a"], "b");
    expect(plan.noop).toBe(true);
  });
});

describe("planReorder — rebalance on float exhaustion", () => {
  it("rebalances the whole set when the target gap can't bisect", () => {
    // p and q are adjacent doubles; dropping m between them has no room.
    const trackIds = ["p", "m", "q"];
    const ranks = { p: ADJACENT_A, m: 50, q: ADJACENT_B };
    expect(orderedSetTrackIds(trackIds, ranks)).toEqual(["p", "q", "m"]);
    const plan = planReorder(trackIds, ranks, ["m"], "q");
    expect(plan.rebalanced).toBe(true);
    expect(plan.ranks).toEqual({ p: 0, m: 1024, q: 2048 });
    expect(orderedSetTrackIds(trackIds, plan.ranks)).toEqual(["p", "m", "q"]);
  });

  it("after a rebalance the same gap is wide again (久用不重算)", () => {
    const trackIds = ["a", "b", "c"];
    // Start with an already-exhausted gap between a and b.
    let ranks: Record<string, number> = { a: 1, b: 1 + Number.EPSILON, c: 5 };
    // Moving c between a and b can't bisect → triggers a whole-set rebalance.
    let plan = planReorder(trackIds, ranks, ["c"], "b");
    expect(plan.rebalanced).toBe(true);
    ranks = plan.ranks;

    // After the rebalance gaps are wide (RANK_SPACING apart), so the next move
    // into a gap takes a clean midpoint — no rebalance.
    const ordered = orderedSetTrackIds(trackIds, ranks); // ["a", "c", "b"]
    plan = planReorder(trackIds, ranks, [ordered[2]], ordered[1]);
    expect(plan.rebalanced).toBe(false);
    expect(new Set(orderedSetTrackIds(trackIds, plan.ranks)).size).toBe(3);
  });
});
