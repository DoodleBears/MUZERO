import { useEffect, useRef, useState } from "react";
import { BACKGROUND_CROSSFADE_MS } from "@/lib/background";
import type { BackgroundLayer } from "@/lib/background-composition";
import { drawBlurFrame } from "@/lib/canvas-blur";
import { useNowPlayingTransition } from "@/lib/now-playing-transition";
import { cn } from "@/lib/utils";
import type { ControllerFrame } from "./use-background-controller";

/**
 * Renders the Background Frame Controller's layer stack as blurred covers (the
 * blur-renderer path; PRD Phase 3). Each layer is one persistent blurred canvas
 * keyed by generation, so a switch mounts exactly one new layer over the held
 * base and unmounts the collapsed ones — no churn. A layer stays at opacity 0
 * until its own image has decoded and drawn (self-gated, so the crossfade never
 * reveals a blank frame), then fades in on the unified `BACKGROUND_CROSSFADE_MS`
 * clock; when the top finishes fading in it calls `onTopSettled`, which collapses
 * the now-covered layers below it.
 */
export function BackgroundFrameStack({
  layers,
  blurPx,
  maxOpacity = 1,
  onTopSettled,
  className,
}: {
  layers: BackgroundLayer<ControllerFrame>[];
  blurPx: number;
  maxOpacity?: number;
  onTopSettled: () => void;
  className?: string;
}) {
  // The cover a drag transition just crossfaded to. When the controller adopts
  // that same cover (it became current on commit), render it INSTANTLY — the
  // transition already did the A→B fade, so a second controller crossfade is the
  // double-flash QA saw. The transition layer fades out over a held-B controller.
  const handedOffCoverUrl = useNowPlayingTransition((s) => s.toCoverUrl);
  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      {layers.map((layer, i) => (
        <BlurLayer
          key={layer.generation}
          url={layer.frame.coverUrl}
          blurPx={blurPx}
          maxOpacity={maxOpacity}
          instant={!!handedOffCoverUrl && layer.frame.coverUrl === handedOffCoverUrl}
          onShown={i === layers.length - 1 ? onTopSettled : undefined}
        />
      ))}
    </div>
  );
}

function BlurLayer({
  url,
  blurPx,
  maxOpacity,
  instant = false,
  onShown,
}: {
  url: string;
  blurPx: number;
  maxOpacity: number;
  /** Appear at full opacity with no fade — the drag transition already faded it
   *  in, so the controller adopting it must not crossfade a second time. */
  instant?: boolean;
  onShown?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.onload = () => {
      if (cancelled) return;
      imgRef.current = image;
      if (canvasRef.current) drawBlurFrame(canvasRef.current, image, blurPx);
      setDrawn(true);
    };
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [url, blurPx]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (imgRef.current && canvasRef.current)
        drawBlurFrame(canvasRef.current, imgRef.current, blurPx);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [blurPx]);

  // Settle (→ collapse the now-covered base layer below) once this layer is fully
  // shown. A TIMER, not onTransitionEnd: a fast / preloaded cover can jump to full
  // opacity without the CSS transition ever firing, so onTransitionEnd would never
  // fire and the covered base would stay alive — bleeding ~10% through (layers are
  // at maxOpacity < 1) — which is the "A residue at the end" QA saw. Instant layers
  // settle at once.
  useEffect(() => {
    if (!drawn) return;
    if (instant) {
      onShown?.();
      return;
    }
    const id = window.setTimeout(() => onShown?.(), BACKGROUND_CROSSFADE_MS);
    return () => window.clearTimeout(id);
  }, [drawn, instant, onShown]);

  return (
    <div ref={hostRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{
          opacity: drawn ? maxOpacity : 0,
          transition: instant ? "none" : `opacity ${BACKGROUND_CROSSFADE_MS}ms ease`,
        }}
      />
    </div>
  );
}
