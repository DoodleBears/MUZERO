/**
 * Pure model for "the ambient background crossfades WITH the drag" (gc-closure
 * PRD Phase 2-D, the Poweramp feel).
 *
 * As the cover strip is dragged, the blurred background should blend from the
 * current track toward the track being revealed — not wait for the gesture to
 * settle. This maps the raw drag offset to a crossfade: a base (current) layer
 * always at full opacity, and an incoming (revealed) layer that fades in on top
 * proportional to how far the drag has travelled. Releasing past the commit
 * threshold lands the incoming track; snapping back returns to progress 0.
 *
 * Sign convention matches the stage / cover-pager: dragging LEFT (negative x)
 * reveals the NEXT track; RIGHT (positive x) reveals the PREVIOUS one.
 *
 * Zero side effects — unit-tested.
 */

export type CrossfadeDirection = "next" | "prev" | "none";

export interface BackgroundCrossfade {
  /** Which neighbour is being revealed by the current drag. */
  direction: CrossfadeDirection;
  /** Normalized drag travel, 0 (at rest) → 1 (a full one-cover drag). */
  progress: number;
  /** Opacity of the base (current-track) blurred layer. */
  currentOpacity: number;
  /** Opacity of the incoming (revealed-track) blurred layer, on top. */
  incomingOpacity: number;
}

const AT_REST: BackgroundCrossfade = {
  direction: "none",
  progress: 0,
  currentOpacity: 1,
  incomingOpacity: 0,
};

/**
 * Map a drag offset (px) to a background crossfade. `width` is the cover width
 * (one full drag step). `gain` lets the background lead/lag the cover slightly
 * (1 = in lock-step). Out-of-range/no-width/no-drag returns the at-rest state.
 */
export function backgroundCrossfadeProgress(
  dragX: number,
  width: number,
  gain = 1,
): BackgroundCrossfade {
  if (!Number.isFinite(dragX) || width <= 0 || dragX === 0) return AT_REST;
  const progress = Math.min(1, Math.max(0, (Math.abs(dragX) / width) * gain));
  if (progress === 0) return AT_REST;
  return {
    direction: dragX < 0 ? "next" : "prev",
    progress,
    currentOpacity: 1,
    incomingOpacity: progress,
  };
}

/** The queue-index delta for the revealed neighbour (+1 next, -1 prev, 0 none). */
export function crossfadeIndexDelta(direction: CrossfadeDirection): number {
  return direction === "next" ? 1 : direction === "prev" ? -1 : 0;
}
