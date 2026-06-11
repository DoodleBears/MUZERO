import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

/** Both track lists share the same scroll viewport size; their scrollable content
 *  height is `count * pitch`, so `scrollHeight / count` recovers a height-agnostic
 *  per-row pitch — letting us map a scroll offset to a row index and back even when
 *  the two lists use different row heights. */
export function topRowIndex(scrollTop: number, scrollHeight: number, count: number): number | null {
  if (count <= 0 || scrollHeight <= 0) return null;
  return Math.round(scrollTop / (scrollHeight / count));
}

export function scrollTopForRow(index: number, scrollHeight: number, count: number): number {
  if (count <= 0 || scrollHeight <= 0) return 0;
  return index * (scrollHeight / count);
}

/** The two list scroll containers (virtual list / reorder list). */
const SCROLL_SELECTOR = '[data-testid="virtual-track-list"], [data-reorder-list]';
/** The non-virtualized reorder list — a plain `scrollTop` write restores it. */
const REORDER_SELECTOR = "[data-reorder-list]";

export interface ListScrollPreservation {
  /** Put on the section root that wraps both scroll containers. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** Topmost visible row index of whichever list last scrolled (null = unknown).
   *  Pass to `VirtualTrackList`'s `initialScrollIndex` so it restores via its own
   *  Lenis-aware virtualizer on mount. */
  anchorIndexRef: RefObject<number | null>;
}

/**
 * Preserve the list scroll position across a swap between the two track-list scroll
 * containers — entering/leaving select mode replaces `VirtualTrackList` with
 * `ReorderableTrackList`, and the fresh container would otherwise mount at the top.
 *
 * A capture-phase listener (scroll doesn't bubble) remembers the topmost row index
 * of whichever list scrolls. After `swapKey` flips, the now-mounted REORDER list is
 * restored here with a plain `scrollTop` write; the VIRTUAL list restores itself via
 * `initialScrollIndex` (through its own virtualizer, which routes via Lenis — a raw
 * write from out here is reverted on Lenis's next frame). Row count is read live so
 * adding/removing tracks never forces a scroll.
 */
export function useListScrollPreservation(swapKey: unknown, count: number): ListScrollPreservation {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const anchorIndexRef = useRef<number | null>(null);
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.matches(SCROLL_SELECTOR)) return;
      const next = topRowIndex(el.scrollTop, el.scrollHeight, countRef.current);
      if (next !== null) anchorIndexRef.current = next;
    };
    root.addEventListener("scroll", onScroll, true);
    return () => root.removeEventListener("scroll", onScroll, true);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restore only on the swap, not on count changes
  useLayoutEffect(() => {
    const index = anchorIndexRef.current;
    if (index === null || index <= 0) return;
    const el = rootRef.current?.querySelector<HTMLElement>(REORDER_SELECTOR);
    if (!el || el.scrollHeight <= 0) return;
    el.scrollTop = scrollTopForRow(index, el.scrollHeight, countRef.current);
  }, [swapKey]);

  return { rootRef, anchorIndexRef };
}
