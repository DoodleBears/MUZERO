/**
 * Pure helpers for keyboard / trackpad navigation of the library gallery. No DOM,
 * no React — so the roving-focus math and the back-swipe accumulator are
 * exhaustively unit-testable; the hooks/components that wire them to events stay
 * thin. See {@link useBackGesture} and the SearchPage roving handler.
 */

/**
 * Next index for roving focus across `count` items. `current` is the focused
 * index or -1 when nothing is focused yet — the first prev/next press lands on
 * `fallback` (the item we backed out of, else the first). Movement clamps at the
 * ends (no wraparound), matching a list you scroll rather than cycle.
 */
export function rovingIndex(
  count: number,
  current: number,
  direction: "prev" | "next",
  fallback = 0,
): number {
  if (count <= 0) return -1;
  const clampedFallback = Math.min(Math.max(fallback, 0), count - 1);
  if (current < 0) return clampedFallback;
  const next = direction === "next" ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), count - 1);
}

/**
 * Fold one wheel delta into a back-swipe accumulator (negative = a left→right
 * trackpad swipe on macOS, where content scrolls left). A vertical-dominant or
 * forward (rightward) gesture cancels the run, so only a sustained horizontal
 * left→right swipe accumulates toward the trigger threshold.
 */
export function accumulateBackSwipe(acc: number, deltaX: number, deltaY: number): number {
  if (Math.abs(deltaY) >= Math.abs(deltaX)) return 0; // vertical scroll → not a back gesture
  if (deltaX > 0) return 0; // rightward (forward) → cancel
  return acc + deltaX; // leftward content shift accumulates negative
}
