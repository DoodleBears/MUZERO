import { useEffect, useRef } from "react";

/**
 * Redraw a canvas-backed layer synchronously on every viewport size change, on top
 * of whatever a ResizeObserver already does.
 *
 * The ambient backgrounds draw into a `<canvas>` whose backing store is sized to the
 * current window but is displayed CSS-stretched (`width/height:100%`). A drag-resize
 * grows the window in ~1px steps, so a redraw landing a frame late stretches the
 * stale backing store by ~1% — invisible. Maximize / fullscreen / F-key DOM
 * fullscreen jump the size in ONE step, and for that big jump the old (smaller)
 * backing store is upscaled to fill the enlarged surface until the next redraw lands
 * — the visible "stretch frame" (割裂). The `window` `resize` event fires pre-paint,
 * so redrawing here repaints at the correct size as early as possible.
 *
 * The latest callback is read through a ref so callers don't need to memoize it.
 */
export function useRedrawOnViewportResize(redraw: () => void): void {
  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => redrawRef.current();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
}
