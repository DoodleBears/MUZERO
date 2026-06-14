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
 * Playing subtitle), not just strings. This is a readability affordance rather
 * than decorative motion. Pausing on hover lets users click a moving link.
 */
export function AutoScrollText({
  children,
  className,
  forceScroll = false,
  staticMode = "truncate",
}: {
  children: ReactNode;
  className?: string;
  forceScroll?: boolean;
  staticMode?: "clip" | "truncate";
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  // Measure once on mount, then only when the content text or the available
  // width actually changes — driven by observers, NOT re-run on every render.
  //
  // The old version had no dependency array, so it re-measured AND rebuilt the
  // ResizeObserver on every commit. A song switch re-renders the whole Now
  // Playing tree and the coverflow stacks several of these (title + subtitle per
  // card), turning each switch into a clone-to-body + forced-reflow storm — the
  // top main-thread cost in the tab-1 switch profile (PRD Phase 32 / QA#49).
  //
  // ResizeObserver catches pill/window resizes; a MutationObserver catches track
  // changes, because the static `truncate` box's *rendered* width doesn't change
  // when the text does (so RO alone would miss it). We still measure against the
  // natural inline width (the clone) so an overflowing line isn't read as fitting.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const measure = () => {
      const viewportWidth = measureVisibleWidth(viewport);
      setViewportWidth((prev) => (prev === viewportWidth ? prev : viewportWidth));
      if (viewportWidth <= 0) {
        setOverflow((prev) => (prev === 0 ? prev : 0));
        return;
      }
      const distance = measureNaturalWidth(content) - viewportWidth;
      const next = distance > OVERFLOW_EPSILON ? distance : 0;
      setOverflow((prev) => (prev === next ? prev : next));
    };
    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);
    const clip = findHorizontalClipElement(viewport);
    if (clip) resizeObserver.observe(clip);

    const mutationObserver =
      typeof MutationObserver !== "undefined" ? new MutationObserver(measure) : null;
    mutationObserver?.observe(content, { characterData: true, childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
    };
  }, []);

  const animate = overflow > 0 || (forceScroll && viewportWidth > 0);
  const style = animate
    ? ({
        "--auto-scroll-x": overflow > 0 ? `-${overflow}px` : `calc(-100% + ${viewportWidth}px)`,
        "--auto-scroll-duration": `${Math.min(
          MAX_DURATION_SEC,
          Math.max(overflow, viewportWidth) / SCROLL_SPEED + DWELL_SEC,
        )}s`,
      } as CSSProperties)
    : undefined;

  return (
    <div ref={viewportRef} className={cn("min-w-0 max-w-full", className)}>
      <div
        ref={contentRef}
        className={cn(
          "whitespace-nowrap",
          animate
            ? "auto-scroll-animate inline-block overflow-visible text-clip"
            : staticMode === "clip"
              ? "inline-block overflow-visible text-clip"
              : "block truncate",
        )}
        style={style}
      >
        {children}
      </div>
    </div>
  );
}

function measureNaturalWidth(element: HTMLDivElement): number {
  const clone = element.cloneNode(true) as HTMLDivElement;
  clone.style.position = "fixed";
  clone.style.left = "-10000px";
  clone.style.top = "-10000px";
  clone.style.visibility = "hidden";
  clone.style.pointerEvents = "none";
  clone.style.animation = "none";
  clone.style.display = "inline-block";
  clone.style.maxWidth = "none";
  clone.style.minWidth = "max-content";
  clone.style.overflow = "visible";
  clone.style.textOverflow = "clip";
  clone.style.transform = "none";
  clone.style.whiteSpace = "nowrap";
  clone.style.width = "max-content";
  document.body.appendChild(clone);
  const width = clone.scrollWidth || clone.getBoundingClientRect().width;
  clone.remove();
  return width;
}

function measureVisibleWidth(viewport: HTMLDivElement): number {
  const widths = [viewport.clientWidth || viewport.getBoundingClientRect().width];
  const clip = findHorizontalClipElement(viewport);
  if (clip) {
    const style = window.getComputedStyle(clip);
    const padding =
      Number.parseFloat(style.paddingLeft || "0") + Number.parseFloat(style.paddingRight || "0");
    const clipWidth = (clip.clientWidth || clip.getBoundingClientRect().width) - padding;
    widths.push(clipWidth);
  }
  const positiveWidths = widths.filter((width) => width > 0);
  return positiveWidths.length > 0 ? Math.min(...positiveWidths) : 0;
}

function findHorizontalClipElement(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (clipsHorizontalOverflow(style)) return node;
    node = node.parentElement;
  }
  return null;
}

function clipsHorizontalOverflow(style: CSSStyleDeclaration): boolean {
  return [style.overflowX, style.overflow].some((value) =>
    ["auto", "clip", "hidden", "scroll"].includes(value),
  );
}
