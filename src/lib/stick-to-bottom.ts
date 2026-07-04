/**
 * Tiny pure helper for "stick to bottom" scroll views (the DJ chat transcript):
 * given a scroll container's metrics, decide whether the viewport is close enough
 * to the bottom that new content should keep it pinned there (the user is
 * "following"), versus scrolled up to read history (leave their position alone).
 *
 * Kept DOM-free so the threshold logic is unit-testable without layout — jsdom
 * doesn't compute real scrollHeight/clientHeight.
 */

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Default slack (px): within this of the bottom still counts as "at bottom". */
export const NEAR_BOTTOM_THRESHOLD = 80;

/**
 * Whether the scroll position is within `threshold` px of the bottom — i.e. the
 * user is following the latest content and new messages should auto-scroll.
 */
export function isNearBottom(
  { scrollTop, scrollHeight, clientHeight }: ScrollMetrics,
  threshold: number = NEAR_BOTTOM_THRESHOLD,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
