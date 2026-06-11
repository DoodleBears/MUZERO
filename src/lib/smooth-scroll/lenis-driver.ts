import type Lenis from "lenis";

/**
 * Shared requestAnimationFrame driver for every active Lenis instance.
 *
 * Multiple scroll containers can be smooth-scrolling at once (e.g. Now Playing's
 * left column + a queue, Settings' two columns). Rather than each Lenis running
 * its own rAF (`autoRaf`), they all register here and a *single* loop ticks them
 * per frame. The loop only runs while at least one instance is active — empty
 * set ⇒ no rAF at all (zero idle cost), mirroring the visualizer's
 * "pause-when-invisible" discipline.
 *
 * Module-scope singleton on purpose: non-reactive, must not live in a Zustand
 * store (would re-render subscribers every frame). See CLAUDE.md rule 6.
 */

const active = new Set<Lenis>();
let frameId = 0;

function tick(time: number): void {
  for (const lenis of active) lenis.raf(time);
  // Self-stopping: only reschedule while something is still active.
  frameId = active.size > 0 ? requestAnimationFrame(tick) : 0;
}

export function registerLenis(lenis: Lenis): void {
  active.add(lenis);
  if (frameId === 0) frameId = requestAnimationFrame(tick);
}

export function unregisterLenis(lenis: Lenis): void {
  active.delete(lenis);
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
