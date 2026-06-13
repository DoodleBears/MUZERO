import { type RefObject, useEffect, useRef, useState } from "react";
import { type AlphabetBucket, bucketIndexAt } from "@/lib/alphabet-index";
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
    // Hit-test against the tight letters block (stripRef), not the full-height
    // centering container — otherwise the top gap pushes the map onto a later letter.
    const rect = strip.getBoundingClientRect();
    const bucket = buckets[bucketIndexAt(clientY, rect.top, rect.height, buckets.length)];
    if (bucket) {
      setActive(bucket.label);
      onJump(bucket.firstIndex);
    }
  };

  if (buckets.length < 2 || height <= 0) return null;

  return (
    <div className="pointer-events-none sticky top-0 right-0 z-30 h-0 w-full" aria-hidden="true">
      {/* Full-height container only centers the letters block in the scrollport. */}
      <div
        className="absolute top-0 right-1 flex w-5 flex-col items-center justify-center"
        style={{ height }}
      >
        <div
          ref={stripRef}
          className="pointer-events-auto flex touch-none select-none flex-col items-center rounded-full bg-background/35 px-1 py-1 backdrop-blur-sm"
          onPointerDown={(event) => {
            event.preventDefault();
            // Capture on the STRIP, not the pressed letter — otherwise the release
            // synthesizes a trailing click on the press-position letter, overriding
            // wherever the drag actually ended.
            event.currentTarget.setPointerCapture?.(event.pointerId);
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
            // Non-interactive labels: the strip's pointer handlers own all jumping
            // (press + drag), so the letters take no clicks of their own — that's
            // what avoids the trailing-click-resets-to-press-position bug.
            <span
              key={bucket.label}
              className={cn(
                "pointer-events-none font-medium text-[10px] text-foreground/55 leading-tight transition-colors",
                active === bucket.label && "text-primary",
              )}
            >
              {bucket.label}
            </span>
          ))}
        </div>
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
