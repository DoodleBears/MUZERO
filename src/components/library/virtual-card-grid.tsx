"use client";

import { elementScroll, useVirtualizer } from "@tanstack/react-virtual";
import type Lenis from "lenis";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type GalleryGridView,
  galleryColumns,
  galleryRowCount,
  galleryRowEstimate,
} from "@/lib/gallery-grid";
import { cn } from "@/lib/utils";
import { rafObserveElementOffset } from "./raf-scroll-offset";

const GRID_GAP = 12; // matches `gap-3` (0.75rem)
const LIST_ROW_HEIGHT = 60; // matches the virtual track row height
const GRID_CAPTION_HEIGHT = 46; // square cover + 2-line caption

export interface VirtualCardGridHandle {
  /** Scroll the card with this key into view (used by roving keyboard nav to
   *  reach a card that virtualization hasn't mounted yet). */
  scrollToKey: (key: string) => void;
}

interface VirtualCardGridProps<T> {
  items: readonly T[];
  view: GalleryGridView;
  /** Stable identity for an item (drives keys + roving-nav lookups). */
  getKey: (item: T) => string;
  /** Render one card; receives the item and its flat index. */
  renderCard: (item: T, index: number) => ReactNode;
  /** The ancestor scroll container the grid virtualizes inside. Passed as a value
   *  (not a ref) so the grid re-renders the instant the parent's callback ref
   *  attaches it: returning from a detail view remounts the wall scroller and this
   *  grid in the SAME commit, where React fires this child's layout effects BEFORE
   *  the parent's ref callback runs — a one-shot `ref.current` read there lands on
   *  `null`, leaving the virtualizer with no scroller so it renders zero rows (the
   *  "empty list after going back" bug). A value prop avoids that race entirely. */
  scrollElement: HTMLElement | null;
  /** Imperative handle (`scrollToKey`) for the wall's roving keyboard nav. */
  gridRef?: RefObject<VirtualCardGridHandle | null>;
  /** Extra classes for the grid wrapper (e.g. bottom padding to clear the dock). */
  className?: string;
  /** Scroll offset (px) to restore on mount — the wall's saved position, so backing
   *  out of a detail lands where you left off instead of at the top. Applied once
   *  the grid row-height estimate is known, so a deep offset isn't clamped against a
   *  not-yet-measured (too-short) virtual spacer. */
  restoreScrollTop?: number;
  /** Card key to focus once on mount (focus restore returning from a detail view). */
  initialFocusKey?: string | null;
  onInitialFocusHandled?: () => void;
  /** The Lenis instance smooth-scrolling the ancestor `scrollElement`, if any —
   *  so the grid's restore/scrollToIndex route through it instead of fighting it. */
  lenisRef?: RefObject<Lenis | null>;
}

/**
 * A virtualized responsive card wall (sets / albums / artists). Only the rows in
 * view mount, so a library with hundreds of entities no longer builds hundreds
 * of cards — and their cover-blob loads — at once.
 *
 * It virtualizes *within an existing ancestor scroll container* (the search
 * page's "wall" scroller) via TanStack's `scrollMargin`, so the page keeps its
 * single scroller, chrome-fade, and scroll-position restore. Cards render the
 * usual `data-gallery-card` markup so the wall's roving keyboard nav still works;
 * the `gridRef` handle's `scrollToKey` lets that nav reach off-screen cards.
 */
export function VirtualCardGrid<T>({
  items,
  view,
  getKey,
  renderCard,
  scrollElement,
  gridRef,
  className,
  restoreScrollTop,
  initialFocusKey,
  onInitialFocusHandled,
  lenisRef,
}: VirtualCardGridProps<T>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1024 : window.innerWidth,
  );
  const [contentWidth, setContentWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  const columns = galleryColumns(viewportWidth, view);
  const rowCount = view === "list" ? items.length : galleryRowCount(items.length, columns);
  const rowEstimate = useMemo(
    () =>
      galleryRowEstimate(view, {
        contentWidth,
        columns,
        gap: GRID_GAP,
        captionHeight: GRID_CAPTION_HEIGHT,
        listRowHeight: LIST_ROW_HEIGHT,
      }),
    [view, contentWidth, columns],
  );

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
    estimateSize: () => rowEstimate,
    // Coalesce native wheel-rate scroll to one window recompute per frame (same as
    // the track list) — smoother heavy walls without smooth-scroll on.
    observeElementOffset: rafObserveElementOffset,
    overscan: view === "grid" ? 3 : 8,
    scrollMargin,
    getItemKey: (rowIndex) => {
      const first = items[rowIndex * (view === "list" ? 1 : columns)];
      return first ? `${rowIndex}:${getKey(first)}` : rowIndex;
    },
    // Route scrollToIndex through the ancestor's Lenis when smooth-scrolling, so
    // it doesn't desync; otherwise the exact default element scroll.
    scrollToFn: (offset, opts, instance) => {
      if (lenisRef?.current) {
        lenisRef.current.scrollTo(offset, { immediate: opts.behavior !== "smooth" });
        return;
      }
      elementScroll(offset, opts, instance);
    },
  });

  // The grid's offset below the toolbar/sort row inside the scroller. TanStack
  // needs it as `scrollMargin`; it shifts when the sort chips wrap, so we
  // re-measure on resize and whenever the chunking changes.
  const measureScrollMargin = useCallback(() => {
    const list = listRef.current;
    if (!list || !scrollElement) return;
    const offset =
      list.getBoundingClientRect().top -
      scrollElement.getBoundingClientRect().top +
      scrollElement.scrollTop;
    setScrollMargin((prev) => (Math.abs(prev - offset) > 0.5 ? offset : prev));
  }, [scrollElement]);

  // Seed the content width synchronously (before paint) so the grid row estimate
  // — and therefore the virtual spacer height — is right on the first frame. The
  // ResizeObserver below keeps it live; this just ensures scroll restore has a
  // tall-enough page to land a deep offset on without waiting for the observer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed when the scroller/view/chunking changes
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) setContentWidth(list.clientWidth);
    measureScrollMargin();
  }, [measureScrollMargin, view, items.length, columns]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Track the content width (for grid row-height estimates) and re-measure the
  // scroll margin when the scroller resizes (chip wrapping shifts the grid).
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setContentWidth(list.clientWidth);
      measureScrollMargin();
    });
    ro.observe(list);
    if (scrollElement) ro.observe(scrollElement);
    setContentWidth(list.clientWidth);
    return () => ro.disconnect();
  }, [scrollElement, measureScrollMargin]);

  // Column / margin changes invalidate cached row measurements (rows now hold a
  // different slice of items), so force a fresh measure pass.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when chunking changes
  useEffect(() => {
    virtualizer.measure();
  }, [columns, scrollMargin, virtualizer]);

  // Keep Lenis' cached scroll limit in sync with the virtual content height. Lenis
  // derives its limit from `wrapper.scrollHeight`, but only recomputes when its
  // ResizeObserver fires for the wrapper's *firstElementChild* — here the short
  // sort-chip row, not this deeply-nested virtual spacer. So when the grid grows
  // (rows measure after mount, or items load in async) Lenis keeps a stale, too-short
  // limit and clamps scrolling above the true bottom ("can't reach the last cards").
  // A `resize()` re-reads the dimensions and realigns to the current scroll, no jump.
  const totalSize = virtualizer.getTotalSize();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync Lenis when the content height changes
  useEffect(() => {
    lenisRef?.current?.resize();
  }, [totalSize]);

  // Restore the wall's saved scroll position once — but only after the grid knows
  // its row height (in grid view that needs the measured content width), otherwise
  // a deep offset clamps against a virtual spacer that's still estimated at the
  // list-row fallback height and the restore is silently lost.
  const didRestoreRef = useRef(false);
  useLayoutEffect(() => {
    if (didRestoreRef.current) return;
    if (!scrollElement || !restoreScrollTop) return;
    if (view === "grid" && contentWidth <= 0) return;
    didRestoreRef.current = true;
    // Route through Lenis when active so the restore lands instead of snapping back.
    if (lenisRef?.current) lenisRef.current.scrollTo(restoreScrollTop, { immediate: true });
    else scrollElement.scrollTop = restoreScrollTop;
  }, [scrollElement, restoreScrollTop, contentWidth, view, lenisRef]);

  const scrollToKey = useCallback(
    (key: string) => {
      const index = items.findIndex((item) => getKey(item) === key);
      if (index < 0) return;
      const row = view === "list" ? index : Math.floor(index / columns);
      virtualizer.scrollToIndex(row, { align: "auto" });
    },
    [items, getKey, view, columns, virtualizer],
  );

  useImperativeHandle(gridRef, () => ({ scrollToKey }), [scrollToKey]);

  // Restore focus to the card the user opened before drilling into a detail view:
  // scroll it into view (it may be virtualized away) and focus it. Retried each
  // frame until the card actually mounts, capped so a missing key (e.g. the set
  // was deleted) can't loop forever. Depends only on the stable `initialFocusKey`;
  // the per-render item list / callbacks / scroll helper are read through a ref so
  // the effect can't re-run mid-retry and restart the loop.
  const focusDepsRef = useRef({ items, getKey, scrollToKey, onInitialFocusHandled });
  focusDepsRef.current = { items, getKey, scrollToKey, onInitialFocusHandled };
  useEffect(() => {
    if (!initialFocusKey) return;
    const sel = `[data-gallery-card-key="${CSS.escape(initialFocusKey)}"]`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    // Poll with a timer rather than rAF: rAF is paused in hidden/background tabs,
    // but focus restore should still land once the user returns.
    const attempt = () => {
      const deps = focusDepsRef.current;
      if (!deps.items.some((item) => deps.getKey(item) === initialFocusKey)) {
        deps.onInitialFocusHandled?.();
        return;
      }
      const el = listRef.current?.querySelector<HTMLElement>(sel);
      if (el) {
        el.focus();
        deps.onInitialFocusHandled?.();
        return;
      }
      if (tries++ > 40) {
        deps.onInitialFocusHandled?.();
        return;
      }
      deps.scrollToKey(initialFocusKey);
      timer = setTimeout(attempt, 16);
    };
    timer = setTimeout(attempt, 0);
    return () => clearTimeout(timer);
  }, [initialFocusKey]);

  if (items.length === 0) return null;

  return (
    <div ref={listRef} className={cn("relative w-full pb-48", className)}>
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const start = view === "list" ? virtualRow.index : virtualRow.index * columns;
          const rowItems = items.slice(start, start + (view === "list" ? 1 : columns));
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={cn(
                "absolute left-0 top-0 w-full",
                view === "grid" ? "grid gap-3 pb-3" : "pb-1",
              )}
              style={{
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                ...(view === "grid"
                  ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
                  : {}),
              }}
            >
              {rowItems.map((item, i) => (
                <div key={getKey(item)}>{renderCard(item, start + i)}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
