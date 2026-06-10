/**
 * Resolve which track row a pointer/click event landed on, via the row's
 * `data-track-index` attribute (set by `TrackRow`). Lets a surface attach a single
 * delegated long-press listener instead of wiring a handler into every row — used
 * by `TrackListSection` to enter multi-select on press-and-hold (drag-reorder PRD).
 * Returns null for anything outside a row, or an out-of-range / malformed index.
 */
export function trackIndexFromEventTarget(
  target: EventTarget | null,
  count: number,
): number | null {
  if (!(target instanceof HTMLElement)) return null;
  const row = target.closest("[data-track-index]");
  if (!row) return null;
  const index = Number(row.getAttribute("data-track-index"));
  if (!Number.isInteger(index) || index < 0 || index >= count) return null;
  return index;
}
