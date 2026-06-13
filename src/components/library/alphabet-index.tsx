import { type RefObject, useEffect, useRef, useState } from "react";
import type { AlphabetBucket } from "@/lib/alphabet-index";
import { cn } from "@/lib/utils";

interface AlphabetIndexProps {
  /** The scroll element — used only to size the strip to the scrollport height. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Ordered { label, firstIndex } from buildAlphabetIndex (name-sorted list). */
  buckets: AlphabetBucket[];
  /** Jump the virtual list to a row index. */
  onJump: (firstIndex: number) => void;
}

/**
 * iOS-style A–Z fast-scroll strip pinned to the scrollport's right edge (via a
 * sticky h-0 overlay, so it doesn't scroll away or restructure the list). Tap a
 * letter to jump; drag along the strip to scrub with a big-letter overlay. Only the
 * name-sorted track list mounts it (the parent passes a transliterating letter fn).
 * See the list-scroll-affordances PRD, Phase 2.
 */
export function AlphabetIndex({ scrollRef, buckets, onJump }: AlphabetIndexProps) {
  const [height, setHeight] = useState(0);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      setHeight(el.clientHeight);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef]);

  const jumpAt = (clientY: number) => {
    const strip = stripRef.current;
    if (!strip || buckets.length === 0) return;
    const rect = strip.getBoundingClientRect();
    const ratio = (clientY - rect.top) / Math.max(1, rect.height);
    const idx = Math.min(buckets.length - 1, Math.max(0, Math.floor(ratio * buckets.length)));
    const bucket = buckets[idx];
    if (bucket) {
      setActive(bucket.label);
      onJump(bucket.firstIndex);
    }
  };

  if (buckets.length < 2 || height <= 0) return null;

  return (
    <div className="pointer-events-none sticky top-0 right-0 z-30 h-0 w-full" aria-hidden="true">
      <div
        ref={stripRef}
        className="pointer-events-auto absolute top-0 right-1 flex w-5 touch-none select-none flex-col items-center justify-center rounded-full bg-background/35 py-1 backdrop-blur-sm"
        style={{ height }}
        onPointerDown={(event) => {
          event.preventDefault();
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          setDragging(true);
          jumpAt(event.clientY);
        }}
        onPointerMove={(event) => {
          if (dragging) jumpAt(event.clientY);
        }}
        onPointerUp={() => {
          setDragging(false);
          setActive(null);
        }}
        onPointerCancel={() => {
          setDragging(false);
          setActive(null);
        }}
      >
        {buckets.map((bucket) => (
          <button
            key={bucket.label}
            type="button"
            tabIndex={-1}
            onClick={() => onJump(bucket.firstIndex)}
            className={cn(
              "font-medium text-[10px] text-foreground/55 leading-tight transition-colors hover:text-primary",
              active === bucket.label && "text-primary",
            )}
          >
            {bucket.label}
          </button>
        ))}
      </div>
      {dragging && active ? (
        <div
          className="pointer-events-none absolute right-8 flex size-14 items-center justify-center rounded-xl bg-popover/95 font-semibold text-2xl text-popover-foreground shadow-lg backdrop-blur"
          style={{ top: height / 2 - 28 }}
        >
          {active}
        </div>
      ) : null}
    </div>
  );
}
