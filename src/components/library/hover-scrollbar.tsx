import { type RefObject, useEffect, useRef, useState } from "react";
import { scrollbarThumb, scrollTopForThumbOffset } from "@/lib/scrollbar-thumb";
import { cn } from "@/lib/utils";

interface HoverScrollbarProps {
  /** The `overflow-y-auto` scroll element. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Apply a scrollTop — routed through Lenis when smooth-scroll is active. */
  scrollToTop: (top: number) => void;
}

/**
 * A hover-reveal overlay scrollbar for the virtual lists: a draggable thumb pinned to
 * the scrollport's right edge (via `sticky`, so it never scrolls away or restructures
 * the list). Hidden until the list is hovered (the scroller carries `group/list`),
 * then drag the thumb to coarse-position a big library fast. Pure geometry lives in
 * `scrollbar-thumb.ts`. See the list-scroll-affordances PRD.
 */
export function HoverScrollbar({ scrollRef, scrollToTop }: HoverScrollbarProps) {
  const [metrics, setMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startOffset: number; thumbSize: number } | null>(null);

  // Track the scroller's metrics on scroll + resize, rAF-coalesced.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      setMetrics({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    el.addEventListener("scroll", schedule, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef]);

  const trackHeight = metrics.clientHeight;
  const thumb = scrollbarThumb(
    metrics.scrollTop,
    metrics.scrollHeight,
    metrics.clientHeight,
    trackHeight,
  );

  // Drag the thumb → map the pointer delta back to a scrollTop.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const nextOffset = drag.startOffset + (event.clientY - drag.startY);
      scrollToTop(
        scrollTopForThumbOffset(
          nextOffset,
          metrics.scrollHeight,
          metrics.clientHeight,
          trackHeight,
          drag.thumbSize,
        ),
      );
    };
    const onUp = () => {
      setDragging(false);
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, metrics.scrollHeight, metrics.clientHeight, trackHeight, scrollToTop]);

  if (!thumb.scrollable) return null;

  return (
    <div className="pointer-events-none sticky top-0 right-0 z-20 h-0 w-full" aria-hidden="true">
      <div
        className={cn(
          "absolute top-0 right-0 w-3 transition-opacity duration-200 group-hover/list:opacity-100",
          dragging ? "opacity-100" : "opacity-0",
        )}
        style={{ height: trackHeight }}
      >
        <button
          type="button"
          aria-label="Scroll position"
          onPointerDown={(event) => {
            event.preventDefault();
            dragRef.current = {
              startY: event.clientY,
              startOffset: thumb.offset,
              thumbSize: thumb.size,
            };
            setDragging(true);
          }}
          style={{ height: thumb.size, transform: `translateY(${thumb.offset}px)` }}
          className={cn(
            "pointer-events-auto absolute top-0 right-0.5 w-1.5 rounded-full bg-foreground/30 transition-colors",
            "hover:bg-foreground/50",
            dragging && "bg-foreground/60",
          )}
        />
      </div>
    </div>
  );
}
