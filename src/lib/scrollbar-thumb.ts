/**
 * Pure geometry for the hover overlay scrollbar (no DOM). `scrollbarThumb` turns the
 * scroller's metrics into a thumb size + offset; `scrollTopForThumbOffset` is the
 * inverse used while dragging the thumb. See the list-scroll-affordances PRD.
 */
export interface ScrollbarThumbGeometry {
  /** Thumb height in px (clamped to >= minThumb). */
  size: number;
  /** Thumb top offset within the track in px (0 .. trackHeight - size). */
  offset: number;
  /** False when the content fits (no scrollbar needed). */
  scrollable: boolean;
}

const MIN_THUMB = 24;

export function scrollbarThumb(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  trackHeight: number,
  minThumb = MIN_THUMB,
): ScrollbarThumbGeometry {
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  if (maxScroll <= 1 || scrollHeight <= 0 || trackHeight <= 0) {
    return { size: trackHeight, offset: 0, scrollable: false };
  }
  const size = Math.max(
    minThumb,
    Math.min(trackHeight, (clientHeight / scrollHeight) * trackHeight),
  );
  const progress = clamp01(scrollTop / maxScroll);
  return { size, offset: progress * (trackHeight - size), scrollable: true };
}

/** The scrollTop that puts the thumb's top at `offset` (clamped to the valid range). */
export function scrollTopForThumbOffset(
  offset: number,
  scrollHeight: number,
  clientHeight: number,
  trackHeight: number,
  thumbSize: number,
): number {
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  const range = Math.max(1, trackHeight - thumbSize);
  return clamp01(offset / range) * maxScroll;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
