import { useEffect, useRef, useState } from "react";
import { drawBlurFrame as drawBlurFrameToCanvas } from "@/lib/canvas-blur";
import { arePerfCountersEnabled, notePerfWork } from "@/lib/perf-counters";
import { cn } from "@/lib/utils";

export function CanvasBlurBackground({
  blurPx,
  className,
  holdPreviousWhileLoading = true,
  src,
}: {
  blurPx: number;
  className?: string;
  holdPreviousWhileLoading?: boolean;
  src: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasARef = useRef<HTMLCanvasElement | null>(null);
  const canvasBRef = useRef<HTMLCanvasElement | null>(null);
  const activeIndexRef = useRef(0);
  const frameRef = useRef<{ blurPx: number; image: HTMLImageElement } | null>(null);
  const hasFrameRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!holdPreviousWhileLoading) {
      frameRef.current = null;
      hasFrameRef.current = false;
      setHasFrame(false);
    }

    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      const nextIndex = hasFrameRef.current ? 1 - activeIndexRef.current : activeIndexRef.current;
      const nextCanvas = nextIndex === 0 ? canvasARef.current : canvasBRef.current;
      if (!nextCanvas) return;
      drawBlurFrame(nextCanvas, image, blurPx);
      frameRef.current = { blurPx, image };
      hasFrameRef.current = true;
      activeIndexRef.current = nextIndex;
      setHasFrame(true);
      setActiveIndex(nextIndex);
    };
    image.onerror = () => {
      if (!cancelled && !hasFrameRef.current) setHasFrame(false);
    };
    image.src = src;

    return () => {
      cancelled = true;
    };
  }, [src, blurPx, holdPreviousWhileLoading]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const redraw = () => {
      const frame = frameRef.current;
      const canvas = activeIndexRef.current === 0 ? canvasARef.current : canvasBRef.current;
      if (frame && canvas) drawBlurFrame(canvas, frame.image, frame.blurPx);
    };
    const ro = new ResizeObserver(redraw);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className={cn("absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
    >
      <img
        src={src}
        alt=""
        decoding="async"
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
          hasFrame ? "opacity-0" : "opacity-100",
        )}
      />
      <canvas
        ref={canvasARef}
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-300",
          hasFrame && activeIndex === 0 ? "opacity-100" : "opacity-0",
        )}
      />
      <canvas
        ref={canvasBRef}
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-300",
          hasFrame && activeIndex === 1 ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

function drawBlurFrame(canvas: HTMLCanvasElement, image: HTMLImageElement, blurPx: number) {
  const perfEnabled = arePerfCountersEnabled();
  const startedAt = perfEnabled ? performance.now() : 0;
  drawBlurFrameToCanvas(canvas, image, blurPx);
  if (perfEnabled) {
    notePerfWork("background.canvasBlur.draw", performance.now() - startedAt, { blurPx });
  }
}
