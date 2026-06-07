import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function CanvasBlurBackground({
  blurPx,
  className,
  src,
}: {
  blurPx: number;
  className?: string;
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
  }, [src, blurPx]);

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
          hasFrame ? "opacity-0" : "opacity-90",
        )}
      />
      <canvas
        ref={canvasARef}
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-300",
          hasFrame && activeIndex === 0 ? "opacity-90" : "opacity-0",
        )}
      />
      <canvas
        ref={canvasBRef}
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-300",
          hasFrame && activeIndex === 1 ? "opacity-90" : "opacity-0",
        )}
      />
    </div>
  );
}

function drawBlurFrame(canvas: HTMLCanvasElement, image: HTMLImageElement, blurPx: number) {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const softness = Math.max(2, Math.min(18, blurPx * 0.45));
  const sampleW = Math.max(32, Math.round(w / softness));
  const sampleH = Math.max(32, Math.round(h / softness));
  const low = document.createElement("canvas");
  low.width = sampleW;
  low.height = sampleH;
  const lowCtx = low.getContext("2d");
  if (!lowCtx) return;

  lowCtx.imageSmoothingEnabled = true;
  lowCtx.imageSmoothingQuality = "high";
  drawImageCover(lowCtx, image, sampleW, sampleH);
  ctx.drawImage(low, 0, 0, sampleW, sampleH, 0, 0, w, h);
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
) {
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const x = (width - drawW) / 2;
  const y = (height - drawH) / 2;
  ctx.drawImage(img, x, y, drawW, drawH);
}
