import type Lenis from "lenis";

/**
 * Shared requestAnimationFrame driver for every active Lenis instance.
 *
 * Multiple scroll containers can be smooth-scrolling at once (e.g. Now Playing's
 * left column + a queue, Settings' two columns). Rather than each Lenis running
 * its own rAF (`autoRaf`), they all register here and wake a shared loop only
 * while scrolling is active. Registered-but-still containers sleep at zero rAF
 * cost, mirroring the visualizer's "pause-when-invisible" discipline.
 *
 * Module-scope singleton on purpose: non-reactive, must not live in a Zustand
 * store (would re-render subscribers every frame). See CLAUDE.md rule 6.
 */

const active = new Set<Lenis>();
const unsubVirtualScroll = new Map<Lenis, () => void>();
const idleFrames = new Map<Lenis, number>();
let frameId = 0;
const IDLE_FRAME_GRACE = 8;

function tick(time: number): void {
  let keepRunning = false;
  for (const lenis of active) {
    lenis.raf(time);
    if (lenis.isScrolling) {
      idleFrames.set(lenis, 0);
      keepRunning = true;
      continue;
    }
    const nextIdleFrames = (idleFrames.get(lenis) ?? 0) + 1;
    idleFrames.set(lenis, nextIdleFrames);
    if (nextIdleFrames < IDLE_FRAME_GRACE) keepRunning = true;
  }
  // Self-stopping: active Lenis instances stay registered, but the shared rAF
  // sleeps once every instance has settled. New wheel/touch/programmatic scroll
  // calls wake it through requestLenisTick().
  frameId = keepRunning && active.size > 0 ? requestAnimationFrame(tick) : 0;
}

export function requestLenisTick(lenis?: Lenis | null): void {
  if (lenis && active.has(lenis)) idleFrames.set(lenis, 0);
  if (frameId === 0 && active.size > 0) frameId = requestAnimationFrame(tick);
}

export function registerLenis(lenis: Lenis): void {
  const alreadyActive = active.has(lenis);
  active.add(lenis);
  idleFrames.set(lenis, 0);
  if (!alreadyActive && typeof lenis.on === "function") {
    unsubVirtualScroll.set(
      lenis,
      lenis.on("virtual-scroll", () => requestLenisTick(lenis)),
    );
  }
  requestLenisTick(lenis);
}

export function unregisterLenis(lenis: Lenis): void {
  active.delete(lenis);
  idleFrames.delete(lenis);
  unsubVirtualScroll.get(lenis)?.();
  unsubVirtualScroll.delete(lenis);
  if (active.size === 0 && frameId !== 0) {
    cancelAnimationFrame(frameId);
    frameId = 0;
  }
}

/**
 * The active Lenis whose wrapper is `element`, if any. Lets a parent route a
 * programmatic scroll through Lenis (so it isn't overridden on the next frame)
 * without holding the child's `lenisRef`.
 */
export function lenisForElement(element: Element): Lenis | null {
  for (const lenis of active) {
    if (lenis.rootElement === element) return lenis;
  }
  return null;
}

/** @internal test-only: how many instances the driver is currently ticking. */
export function __activeCount(): number {
  return active.size;
}

/** @internal test-only: drop all instances and stop the loop between tests. */
export function __resetDriver(): void {
  active.clear();
  if (frameId !== 0) {
    cancelAnimationFrame(frameId);
    frameId = 0;
  }
}
