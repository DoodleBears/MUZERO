/**
 * Pure math for the unified Now Playing transition (Background Frame Controller
 * PRD, Phase 1). A single "transition" carries a frozen direction + endpoints and
 * a normalized progress 0..1; it can be driven manually (drag) or automatically
 * (button / keyboard / drag-release), and a manual drag auto-completes on release
 * (Swiper semantics). These helpers are the progress / commit / timing math; the
 * frozen endpoints + layer stack live in the composition reducer.
 *
 * Sign convention (matches the stage / cover-pager): drag LEFT (negative x) =
 * NEXT; drag RIGHT (positive x) = PREVIOUS.
 *
 * Zero side effects — unit-tested.
 */

export type TransitionDirection = "next" | "prev";

/** Drag sign → switch direction; null inside the deadzone. */
export function dragDirection(dragX: number, deadzone = 0): TransitionDirection | null {
  if (dragX < -deadzone) return "next";
  if (dragX > deadzone) return "prev";
  return null;
}

/** Manual drag → normalized progress 0..1 (|dragX| / width, clamped). */
export function manualProgress(dragX: number, width: number): number {
  if (width <= 0) return 0;
  return Math.min(1, Math.abs(dragX) / width);
}

/**
 * Whether a release should commit (vs cancel): dragged past the distance
 * threshold, OR a fast fling whose direction matches the drag.
 */
export function shouldCommitRelease(opts: {
  progress: number;
  velocity: number;
  direction: TransitionDirection;
  threshold?: number;
  flingVelocity?: number;
}): boolean {
  const threshold = opts.threshold ?? 0.3;
  const fling = opts.flingVelocity ?? 500;
  const flingMatchesDirection =
    opts.direction === "next" ? opts.velocity <= -fling : opts.velocity >= fling;
  return opts.progress >= threshold || flingMatchesDirection;
}

/** Auto-complete target progress: commit → 1, cancel → 0. */
export function autoCompleteTarget(commit: boolean): 0 | 1 {
  return commit ? 1 : 0;
}

/**
 * Remaining auto-animation duration (ms): proportional to the remaining distance,
 * optionally shortened by a fast release (velocity-aware) but never below a floor
 * (so a fling never snaps instantly).
 */
export function remainingDurationMs(opts: {
  fromProgress: number;
  toProgress: number;
  baseMs: number;
  velocity?: number;
  width?: number;
}): number {
  const dist = Math.abs(opts.toProgress - opts.fromProgress);
  let ms = opts.baseMs * dist;
  if (opts.velocity && opts.width && opts.width > 0) {
    const remainingPx = dist * opts.width;
    const vMag = Math.abs(opts.velocity);
    if (vMag > 0) {
      const velMs = (remainingPx / vMag) * 1000;
      const floor = opts.baseMs * 0.15;
      ms = Math.min(ms, Math.max(velMs, floor));
    }
  }
  return Math.round(ms);
}
