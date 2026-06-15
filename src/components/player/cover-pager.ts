/**
 * Pure geometry/slot model for the persistent Now Playing cover pager.
 *
 * The pager is a fixed strip of `2*radius+1` slots that NEVER mount/unmount on a
 * track switch — each slot keeps a stable `slotKey` (its DOM identity) and only
 * its assigned `queueIndex` rotates as the center moves (recycling-list pattern).
 * The drag translates the whole strip by one transform write; individual slots
 * sit at their static rest offset. This keeps the switch animation on the
 * compositor and off the React/data plane (no per-switch VNode/Motion churn).
 *
 * Sign convention (matches the existing swipeable stage): dragging LEFT (negative
 * x) reveals the NEXT track; dragging RIGHT (positive x) reveals the PREVIOUS one.
 *
 * Zero DOM, zero side effects — exhaustively unit-tested.
 */

export interface PagerSlot {
  /** Stable DOM identity (0..2*radius). Never changes with the center, so the
   *  node for a given slotKey is reused; only `queueIndex` content rotates. */
  slotKey: number;
  /** The queue item occupying this slot now, or null when out of range. */
  queueIndex: number | null;
  /** Position relative to the center, in steps (-radius..+radius). */
  offsetSteps: number;
}

/**
 * Assign the persistent slots for a given center. The center sits at the middle
 * slotKey (`radius`); slots whose `centerIndex + offset` falls outside the queue
 * (or when there is no current track) get `queueIndex: null`.
 */
export function assignPagerSlots(
  centerIndex: number,
  queueLength: number,
  radius: number,
): PagerSlot[] {
  const slots: PagerSlot[] = [];
  const hasCenter = centerIndex >= 0 && queueLength > 0;
  for (let offset = -radius; offset <= radius; offset++) {
    const queueIndex = centerIndex + offset;
    const inRange = hasCenter && queueIndex >= 0 && queueIndex < queueLength;
    slots.push({
      slotKey: offset + radius,
      queueIndex: inRange ? queueIndex : null,
      // `|| 0` normalizes the `-0` produced by `offset = -radius` at radius 0.
      offsetSteps: offset || 0,
    });
  }
  return slots;
}

/** Translate of the whole strip while dragging (px). */
export function pagerTranslate(dragX: number, gain = 1): number {
  return dragX * gain;
}

/** Static rest position of a slot relative to the strip origin (px). */
export function slotRestOffsetPx(offsetSteps: number, width: number): number {
  return offsetSteps * width;
}

/**
 * Direction a release should commit to, as a delta on the center index.
 * +1 = next (dragged left past threshold), -1 = prev (dragged right), 0 = snap
 * back. `threshold` is a fraction of `width`. Never commits without a width.
 */
export function resolvePagerSettle(dragX: number, width: number, threshold = 0.25): -1 | 0 | 1 {
  if (width <= 0) return 0;
  const trigger = width * threshold;
  if (dragX <= -trigger) return 1;
  if (dragX >= trigger) return -1;
  return 0;
}

/** Apply a settle delta to the center index, clamped to the queue bounds. */
export function applyPagerSettle(centerIndex: number, delta: number, queueLength: number): number {
  if (queueLength <= 0) return centerIndex;
  return Math.max(0, Math.min(queueLength - 1, centerIndex + delta));
}
