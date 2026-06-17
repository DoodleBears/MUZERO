import { motionValue } from "motion/react";

/**
 * Shared "cover window" channel between the Now Playing cover pager (foreground
 * coverflow strip) and the ambient Pixi background. Both planes read the SAME
 * window content + the SAME per-frame drag offset, so they slide in lockstep
 * through the neighbour covers during a continuous, chainable drag.
 *
 * This is a module-scope, non-reactive singleton (hard rule 6: singletons live
 * at module scope, not in component-selected Zustand state). The orchestrator —
 * `SwipeableCoverStage` — PUSHES the window content here (`setCoverWindow`) and
 * drives the offset (`coverWindowOffset`); the background (`PixiPixelBackground`)
 * is a pure follower that mirrors whatever it reads. Splitting the two by cadence:
 *
 *  - `coverWindowOffset` is a per-frame MotionValue (driven imperatively off the
 *    React render path) — 0 = centred; negative = dragging toward the next track,
 *    positive = toward the previous one (the existing cover-pager sign convention).
 *  - the window CONTENT (`slots` + `active`) changes only on discrete events
 *    (recenter / queue edit / a cover resolving), surfaced via `subscribeWindow`.
 *
 * The window NEVER advances the player store mid-drag; the visual centre leads and
 * the store is committed once the gesture settles (see `SwipeableCoverStage`).
 */
export const coverWindowOffset = motionValue(0);

/** One cover in the window, keyed by its step offset from the centre (0 = centre). */
export interface CoverWindowSlot {
  offsetSteps: number;
  trackId: string;
  /** Resolved (preloaded) cover URL, or null while loading / for a coverless track. */
  coverUrl: string | null;
}

export interface CoverWindowState {
  /** True while a drag/chain window is open — the background uses this to decide
   *  whether to run the lockstep sprite window vs its single-step resting path. */
  active: boolean;
  /** Centre-out slots for offsets -radius..+radius (a missing offset = empty edge). */
  slots: CoverWindowSlot[];
}

const EMPTY: CoverWindowState = { active: false, slots: [] };
let state: CoverWindowState = EMPTY;
const listeners = new Set<() => void>();

/** Current immutable window snapshot (stable reference until content changes). */
export function getCoverWindow(): CoverWindowState {
  return state;
}

/** Subscribe to DISCRETE window-content changes (not the per-frame offset). */
export function subscribeWindow(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Replace the window content. No-op (no emit) when nothing observable changed, so
 * the background doesn't churn `setWindow` on identical content (the queue
 * liveQuery hands back fresh arrays on unrelated edits).
 */
export function setCoverWindow(next: CoverWindowState): void {
  if (next.active === state.active && slotsEqual(next.slots, state.slots)) return;
  state = next;
  for (const listener of listeners) listener();
}

/** Reset to the idle (no window) state — used when the stage unmounts / hides. */
export function clearCoverWindow(): void {
  coverWindowOffset.set(0);
  setCoverWindow(EMPTY);
}

function slotsEqual(a: CoverWindowSlot[], b: CoverWindowSlot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x.offsetSteps !== y.offsetSteps || x.trackId !== y.trackId || x.coverUrl !== y.coverUrl) {
      return false;
    }
  }
  return true;
}
