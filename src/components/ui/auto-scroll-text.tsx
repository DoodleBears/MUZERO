import { useReducedMotion } from "motion/react";
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Below this overflow (px) we leave the line static — not worth animating 1–2px. */
const OVERFLOW_EPSILON = 6;
/** Roughly px-per-second the line travels; tunes how long the scroll takes. */
const SCROLL_SPEED = 40;
/** Seconds spent dwelling at the two ends (split across both pauses). */
const DWELL_SEC = 4;
/** Don't let a very long line take forever to make a round trip. */
const MAX_DURATION_SEC = 18;

/**
 * Single-line text that ping-pong scrolls (auto back-and-forth) when it overflows
 * its container, and stays put — truncating with an ellipsis — when it fits. The
 * motion is a CSS keyframe (`auto-scroll-text` in styles.css); here we only measure
 * the overflow and feed it the travel distance + duration via CSS variables.
 *
 * While scrolling, this element deliberately does NOT clip itself — the overflowing
 * text spills out so the *parent* masks it. Put this inside a rounded
 * `overflow-hidden` container (e.g. the Now Playing pills) and the text is clipped
 * along that rounded edge instead of at a hard rectangle inset from it.
 *
 * Works with rich children (e.g. the clickable artist/album links in the Now
 * Playing subtitle), not just strings. Honors `prefers-reduced-motion` (falls back
 * to a static truncated line), and pausing on hover lets users click a moving link.
 */
export function AutoScrollText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [overflow, setOverflow] = useState(0);

  // Re-measure after every commit (cheap: two layout reads) and on resize. The
  // commit pass catches track changes; the observer catches the pill/window
  // resizing. `scrollWidth` reports the full text width in both the static
  // (block + truncate) and scrolling (inline natural width) modes, so the value
  // is stable across modes and never flip-flops.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const measure = () => {
      const distance = content.scrollWidth - viewport.clientWidth;
      const next = distance > OVERFLOW_EPSILON ? distance : 0;
      setOverflow((prev) => (prev === next ? prev : next));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  });

  const animate = overflow > 0 && !reduceMotion;
  const style = animate
    ? ({
        "--auto-scroll-x": `-${overflow}px`,
        "--auto-scroll-duration": `${Math.min(MAX_DURATION_SEC, overflow / SCROLL_SPEED + DWELL_SEC)}s`,
      } as CSSProperties)
    : undefined;

  return (
    <div ref={viewportRef} className={className}>
      <div
        ref={contentRef}
        className={cn(
          "whitespace-nowrap",
          animate ? "auto-scroll-animate inline-block" : "block truncate",
        )}
        style={style}
      >
        {children}
      </div>
    </div>
  );
}
