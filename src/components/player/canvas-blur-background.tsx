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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let cleanupResize: (() => void) | undefined;
    setReady(false);

    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;

      const draw = () => {
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
        if (!cancelled) setReady(true);
      };

      draw();
      const ro = new ResizeObserver(draw);
      ro.observe(canvas);
      cleanupResize = () => ro.disconnect();
    };
    image.onerror = () => {
      if (!cancelled) setReady(false);
    };
    image.src = src;

    return () => {
      cancelled = true;
      cleanupResize?.();
    };
  }, [src, blurPx]);

  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      <img
        src={src}
        alt=""
        decoding="async"
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
          ready ? "opacity-0" : "opacity-90",
        )}
      />
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-300",
          ready ? "opacity-90" : "opacity-0",
        )}
      />
    </div>
  );
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
