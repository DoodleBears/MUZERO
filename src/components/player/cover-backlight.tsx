import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function CoverBacklightCanvas({
  blur,
  className,
  saturation,
  url,
}: {
  blur: number;
  className?: string;
  saturation: number;
  url: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<{ blur: number; image: HTMLImageElement; saturation: number } | null>(
    null,
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);

    const image = new Image();
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.onload = () => {
      if (cancelled) return;
      frameRef.current = { blur, image, saturation };
      const drawn = drawBacklightFrame(canvasRef.current, image, blur, saturation);
      if (drawn && !cancelled) setReady(true);
    };
    image.onerror = () => {
      if (!cancelled) setReady(false);
    };
    image.src = url;

    return () => {
      cancelled = true;
    };
  }, [blur, saturation, url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => {
      const frame = frameRef.current;
      if (!frame) return;
      if (drawBacklightFrame(canvas, frame.image, frame.blur, frame.saturation)) setReady(true);
    };
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn(
        "absolute inset-0 size-full object-cover transition-opacity duration-150 album-cover-radius",
        ready ? "opacity-100" : "opacity-0",
        className,
      )}
      style={{
        backfaceVisibility: "hidden",
        transform: "scale(var(--now-playing-cover-backlight-scale, 1.12))",
        willChange: "transform",
      }}
    />
  );
}

function drawBacklightFrame(
  canvas: HTMLCanvasElement | null,
  image: HTMLImageElement,
  blurPx: number,
  saturation: number,
): boolean {
  if (!canvas || image.naturalWidth <= 0 || image.naturalHeight <= 0) return false;

  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = get2d(canvas);
  if (!ctx) return false;
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const softness = Math.max(2, Math.min(24, blurPx * 0.55));
  const sampleW = Math.max(24, Math.round(w / softness));
  const sampleH = Math.max(24, Math.round(h / softness));
  const low = document.createElement("canvas");
  low.width = sampleW;
  low.height = sampleH;
  const lowCtx = get2d(low);
  if (!lowCtx) return false;

  lowCtx.imageSmoothingEnabled = true;
  lowCtx.imageSmoothingQuality = "high";
  drawImageCover(lowCtx, image, sampleW, sampleH);

  ctx.filter = `saturate(${saturation}%)`;
  ctx.drawImage(low, 0, 0, sampleW, sampleH, 0, 0, w, h);
  ctx.filter = "none";
  return true;
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

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext("2d");
  } catch {
    return null;
  }
}
