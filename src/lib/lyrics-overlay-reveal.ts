/**
 * Decide whether the pinned lyrics-overlay control bar should be revealed.
 *
 * When LOCKED (pin-click-through — the OBS/desktop capture state) ONLY the
 * control-bar region may reveal it, reported by the OS cursor poll as
 * `clickThroughHover`. Global pointer activity (`!idle`) must NOT reveal it: in
 * the locked capture the rest of the window is click-through and must stay fully
 * transparent, so moving or clicking *near* the lyrics should not flash the bar's
 * translucent background. The control bar sits dead-center over the lyrics, so the
 * only trigger zone is that centered region.
 *
 * When merely pinned (still interactive/draggable, not click-through) the bar
 * keeps revealing on any pointer activity so the unpin control is easy to find.
 */
export function resolveLyricsOverlayRevealed({
  locked,
  idle,
  clickThroughHover,
}: {
  locked: boolean;
  idle: boolean;
  clickThroughHover: boolean;
}): boolean {
  if (locked) return clickThroughHover;
  return !idle || clickThroughHover;
}
