/**
 * While a virtual list is scrolling we want to AVOID starting new cover-derivative
 * work (worker queue jank), but we must NOT throw away covers that already resolved
 * — dropping them flashes a blurry thumbhash over art the user was already seeing
 * (the "scroll downgrades loaded covers" bug). This keeps the resolved entry only
 * when it's still for the current cover (the row may have recycled to another track
 * mid-scroll, in which case showing the old art would be wrong → placeholder). See
 * the cover-quality-and-scroll PRD, Phase 1.
 */
export function keepDeferredCover<T extends { forKey: string }>(
  resolved: T | null,
  coverKey: string,
): T | null {
  return resolved && resolved.forKey === coverKey ? resolved : null;
}
