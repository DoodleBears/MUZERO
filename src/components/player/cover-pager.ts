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

/**
 * Continuous on-screen position of a slot, in step units. `offset` is the live
 * fractional drag (0 = centered; negative = dragging toward next; positive =
 * toward prev — the existing sign convention). A slot at `offsetSteps` sits at
 * `offsetSteps + offset`: at the rest center its screenX is 0; while dragging the
 * whole window shifts by `offset` so each slot keeps its relative spacing.
 */
export function slotScreenXSteps(offsetSteps: number, offset: number): number {
  return offsetSteps + offset;
}

export interface CoverflowTransform {
  rotateY: number;
  scale: number;
  opacity: number;
}

/**
 * Coverflow 3D transform for a slot at continuous position `screenXSteps` (step
 * units, from {@link slotScreenXSteps}). Each cover pivots around its own centre:
 * the centred cover (0) is flat / full-scale / opaque; a cover one step away
 * (±1) is tilted ∓`tilt`°, scaled to `sideScale`, and faded out. Mirrors the
 * piecewise ramps the legacy `useCoverflowCard` used, but as a pure function so
 * it's unit-tested and shared by the strip slots. Beyond ±1 step the values
 * clamp (rotation/scale hold, opacity stays 0).
 */
export function coverflowTransform(
  screenXSteps: number,
  opts: { tilt: number; sideScale: number },
): CoverflowTransform {
  const { tilt, sideScale } = opts;
  return {
    rotateY: piecewise(screenXSteps, [-1, 0, 1], [tilt, 0, -tilt]),
    scale: piecewise(screenXSteps, [-1, 0, 1], [sideScale, 1, sideScale]),
    // Reach 0 right at ±1 step so an outgoing cover is fully faded by the time
    // the window parks one step over; the 0.6 knees keep side covers readable.
    opacity: piecewise(screenXSteps, [-1, -0.55, 0, 0.55, 1], [0, 0.6, 1, 0.6, 0]),
  };
}

/**
 * Integer step delta the window should recenter by, given the live continuous
 * `offset`. Returns the truncated-toward-zero integer part (0 while `|offset| < 1`,
 * ∓1 once a full step is dragged, ∓N for a fast multi-step fling in one frame).
 * The caller recenters by this delta and subtracts it from `offset`, so the
 * residual fraction continues the drag seamlessly (no snap).
 */
export function pendingRecenterSteps(offset: number): number {
  // `|| 0` normalizes the `-0` Math.trunc returns for a small negative offset.
  return Math.trunc(offset) || 0;
}

/** Clamped piecewise-linear interpolation over ascending `inX` → `outY` knots. */
function piecewise(x: number, inX: readonly number[], outY: readonly number[]): number {
  if (x <= inX[0]) return outY[0];
  const last = inX.length - 1;
  if (x >= inX[last]) return outY[last];
  for (let i = 0; i < last; i += 1) {
    const x0 = inX[i];
    const x1 = inX[i + 1];
    if (x >= x0 && x <= x1) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return outY[i] + (outY[i + 1] - outY[i]) * t;
    }
  }
  return outY[last];
}
