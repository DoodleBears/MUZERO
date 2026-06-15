import { type RefObject, useEffect, useRef } from "react";
import { crossfadeLayerOpacities } from "@/lib/background-crossfade";
import { drawBlurFrame } from "@/lib/canvas-blur";
import { nowPlayingDragX, useNowPlayingDragRing } from "@/lib/now-playing-drag";
import { cn } from "@/lib/utils";

/**
 * Ambient background layer that crossfades WITH a cover drag (PRD Phase 2-D).
 *
 * Renders two blurred covers — the next and previous tracks — stacked over the
 * resting background. While the stage is dragged, the layer in the drag's
 * direction fades in proportional to the drag (driven imperatively from the
 * shared `nowPlayingDragX` MotionValue, so dragging never re-renders React). At
 * rest both layers are fully transparent, so this is purely additive — the
 * resting background is unchanged when nothing is being dragged.
 *
 * Uses the same WKWebView-safe canvas downsample blur as `CanvasBlurBackground`
 * (no full-screen CSS `filter`).
 */
export function DragCrossfadeBackground({
  blurPx,
  maxOpacity = 0.9,
  className,
}: {
  blurPx: number;
  maxOpacity?: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const nextCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const nextImgRef = useRef<HTMLImageElement | null>(null);
  const prevImgRef = useRef<HTMLImageElement | null>(null);
  const nextUrl = useNowPlayingDragRing((s) => s.nextUrl);
  const prevUrl = useNowPlayingDragRing((s) => s.prevUrl);

  useEffect(() => drawUrlToCanvas(nextUrl, nextCanvasRef, nextImgRef, blurPx), [nextUrl, blurPx]);
  useEffect(() => drawUrlToCanvas(prevUrl, prevCanvasRef, prevImgRef, blurPx), [prevUrl, blurPx]);

  // Redraw the blurred frames when the host resizes (canvas is sized in CSS px).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const redraw = () => {
      if (nextImgRef.current && nextCanvasRef.current)
        drawBlurFrame(nextCanvasRef.current, nextImgRef.current, blurPx);
      if (prevImgRef.current && prevCanvasRef.current)
        drawBlurFrame(prevCanvasRef.current, prevImgRef.current, blurPx);
    };
    const ro = new ResizeObserver(redraw);
    ro.observe(host);
    return () => ro.disconnect();
  }, [blurPx]);

  // Drive each layer's opacity straight from the shared drag MotionValue — no
  // React state, no re-render per pointer frame.
  useEffect(() => {
    const apply = (x: number) => {
      const width = useNowPlayingDragRing.getState().width;
      const { next, prev } = crossfadeLayerOpacities(x, width);
      if (nextCanvasRef.current) nextCanvasRef.current.style.opacity = String(next * maxOpacity);
      if (prevCanvasRef.current) prevCanvasRef.current.style.opacity = String(prev * maxOpacity);
    };
    apply(nowPlayingDragX.get());
    return nowPlayingDragX.on("change", apply);
  }, [maxOpacity]);

  return (
    <div
      ref={hostRef}
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
    >
      <canvas
        ref={prevCanvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ opacity: 0 }}
      />
      <canvas
        ref={nextCanvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ opacity: 0 }}
      />
    </div>
  );
}

function drawUrlToCanvas(
  url: string | null,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  imgRef: RefObject<HTMLImageElement | null>,
  blurPx: number,
): (() => void) | undefined {
  imgRef.current = null;
  const canvas = canvasRef.current;
  if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  if (!url) return;
  let cancelled = false;
  const image = new Image();
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.onload = () => {
    if (cancelled) return;
    imgRef.current = image;
    if (canvasRef.current) drawBlurFrame(canvasRef.current, image, blurPx);
  };
  image.src = url;
  return () => {
    cancelled = true;
  };
}
