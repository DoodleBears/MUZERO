/**
 * Pure 歌单内分数序(fractional ordering) — no DB, no DOM. Each track in a set
 * holds a float `rank`; a drag updates ONE rank (the midpoint between its new
 * neighbors). When a midpoint can no longer be represented (the float gap is
 * exhausted) the whole set is rebalanced to evenly-spaced integers, ONCE, and
 * then it's good for a long time again. See the drag-reorder PRD §3.3/§3.4.
 *
 * Exhaustively unit-tested (hard rule #7), mirroring play-queue.ts / queue.ts:
 * the Dexie repo and the drag UI build on these; all the fiddly edge cases
 * (drop-at-top / drop-at-end / empty-neighbor / first-drag / no-op) live here.
 */

/** Initial / rebalance spacing (integer → tidy numbers after a rebalance). */
export const RANK_SPACING = 1024;

/**
 * Midpoint of two ranks. Returns `null` when the float gap is exhausted (the
 * midpoint collides with an endpoint) — the precise form of the "epsilon"
 * condition (~1 ULP), independent of magnitude. A fixed absolute epsilon would
 * drift at large magnitudes (a common fractional-index bug), so we don't use one.
 */
export function rankBetween(a: number, b: number): number | null {
  const mid = (a + b) / 2;
  return mid > a && mid < b ? mid : null;
}

/** Drop at the very top / very end: extend outward — always has room, never rebalances. */
export function rankBefore(min: number): number {
  return min - RANK_SPACING;
}
export function rankAfter(max: number): number {
  return max + RANK_SPACING;
}

/**
 * K order-preserving, strictly-increasing ranks inside the open interval (a, b).
 * Returns `null` when the gap can't hold K distinct doubles → the caller
 * rebalances and retries. (Single-item move is just K = 1.)
 */
export function ranksForBlock(a: number, b: number, k: number): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(a + ((b - a) * (i + 1)) / (k + 1));
  let prev = a;
  for (const r of out) {
    if (!(r > prev && r < b)) return null;
    prev = r;
  }
  return out;
}

/** K increasing ranks all below `belowRank` (drop a block at the very top). */
export function ranksAtTop(belowRank: number, k: number): number[] {
  return Array.from({ length: k }, (_, i) => belowRank - (k - i) * RANK_SPACING);
}

/** K increasing ranks all above `aboveRank` (drop a block at the very end). */
export function ranksAtBottom(aboveRank: number, k: number): number[] {
  return Array.from({ length: k }, (_, i) => aboveRank + (i + 1) * RANK_SPACING);
}

/** Assign evenly-spaced integer ranks to an ordered id list. Batch, low-frequency. */
export function rebalance(orderedIds: readonly string[]): Record<string, number> {
  const ranks: Record<string, number> = {};
  orderedIds.forEach((id, i) => {
    ranks[id] = i * RANK_SPACING;
  });
  return ranks;
}

/**
 * The one and only order arbiter. Ranks absent → return trackIds unchanged
 * (legacy set, order = membership array). Otherwise stable-sort by rank ascending,
 * tiebroken by original array index — so missing/NaN/duplicate ranks still yield a
 * deterministic total order and never drop a member.
 */
export function orderedSetTrackIds(
  trackIds: readonly string[],
  ranks?: Record<string, number>,
): string[] {
  if (!ranks || Object.keys(ranks).length === 0) return [...trackIds];
  return trackIds
    .map((id, index) => ({ id, index, rank: ranks[id] }))
    .sort((x, y) => {
      const xr = x.rank ?? Number.POSITIVE_INFINITY;
      const yr = y.rank ?? Number.POSITIVE_INFINITY;
      if (xr !== yr) return xr - yr;
      return x.index - y.index;
    })
    .map((e) => e.id);
}

export interface ReorderPlan {
  /** Nothing changed — the caller skips both the rank write and the sync mutation. */
  noop: boolean;
  /** The whole set was rewritten (first materialization, or a float-exhaustion rebalance). */
  rebalanced: boolean;
  /** Complete new rank map covering every trackId. Persist as `session.trackRanks`. */
  ranks: Record<string, number>;
  /** (trackId, rank) pairs for the sync mutation: block move → K, rebalance → all. */
  changed: Array<{ trackId: string; rank: number }>;
}

function noopPlan(ranks: Record<string, number> | undefined): ReorderPlan {
  return { noop: true, rebalanced: false, ranks: ranks ?? {}, changed: [] };
}

function rebalancedPlan(orderedIds: string[]): ReorderPlan {
  const ranks = rebalance(orderedIds);
  return {
    noop: false,
    rebalanced: true,
    ranks,
    changed: orderedIds.map((id) => ({ trackId: id, rank: ranks[id] })),
  };
}

/**
 * Plan a drag-reorder: move `blockIds` (one row, or a whole multi-select block —
 * passed in any order; its members keep their current relative order) so they land
 * immediately before `insertBeforeId` in the set's current order, or at the very
 * end when it's `null`. Pure: the repo applies `plan.ranks` and records a
 * `track-reordered-in-set` mutation from `plan.changed` (skips both on `noop`).
 *
 * All the §3.4 edge cases are handled here: drop-at-top / drop-at-end (extend
 * outward, never rebalances), drop-in-middle (midpoint, rebalances only on float
 * exhaustion), first-drag (lazy materialize → rebalance the final order), and
 * no-op (dropped back in place, or the whole set moved → order can't change).
 */
export function planReorder(
  trackIds: readonly string[],
  ranks: Record<string, number> | undefined,
  blockIds: readonly string[],
  insertBeforeId: string | null,
): ReorderPlan {
  const blockSet = new Set(blockIds);
  // Dropping before a member of the moving block is ambiguous → no-op (defensive).
  if (insertBeforeId !== null && blockSet.has(insertBeforeId)) return noopPlan(ranks);

  const ordered = orderedSetTrackIds(trackIds, ranks);
  // Canonical block order = block ids in their CURRENT order (selection is a Set).
  const block = ordered.filter((id) => blockSet.has(id));
  if (block.length === 0) return noopPlan(ranks);

  // Neighbors are computed on the list WITH the block removed — otherwise a row
  // would see itself as its own neighbor and mis-bisect.
  const remaining = ordered.filter((id) => !blockSet.has(id));
  const found = insertBeforeId === null ? remaining.length : remaining.indexOf(insertBeforeId);
  const at = found < 0 ? remaining.length : found;

  const next = [...remaining.slice(0, at), ...block, ...remaining.slice(at)];
  // No-op: the resulting order is identical to the current order.
  if (next.length === ordered.length && next.every((id, i) => id === ordered[i])) {
    return noopPlan(ranks);
  }

  const materialized = !!ranks && Object.keys(ranks).length > 0;
  const coversAll = materialized && trackIds.every((id) => ranks?.[id] !== undefined);
  // Unmaterialized (first ever drag) or partially-ranked (defensive) → assign the
  // FINAL order from scratch; remote has no ranks yet, so carry them all.
  if (!materialized || !coversAll) return rebalancedPlan(next);

  const above = at > 0 ? ranks?.[remaining[at - 1]] : undefined;
  const below = at < remaining.length ? ranks?.[remaining[at]] : undefined;
  const k = block.length;

  let blockRanks: number[] | null;
  if (above === undefined && below === undefined) {
    // remaining empty — unreachable (whole-set move is a no-op) but stay safe.
    blockRanks = block.map((_, i) => i * RANK_SPACING);
  } else if (above === undefined) {
    blockRanks = ranksAtTop(below as number, k);
  } else if (below === undefined) {
    blockRanks = ranksAtBottom(above, k);
  } else {
    blockRanks = ranksForBlock(above, below, k);
  }

  // Float gap exhausted → rebalance the whole resulting order, once. Afterwards the
  // gaps are wide again, so subsequent moves bisect cleanly for a long time.
  if (blockRanks === null) return rebalancedPlan(next);

  const updated = { ...ranks };
  const changed: Array<{ trackId: string; rank: number }> = [];
  block.forEach((id, i) => {
    updated[id] = (blockRanks as number[])[i];
    changed.push({ trackId: id, rank: (blockRanks as number[])[i] });
  });
  return { noop: false, rebalanced: false, ranks: updated, changed };
}
