import { useEffect, useRef, useState } from "react";
import { drawBlurFrame } from "@/lib/canvas-blur";
import { transitionProgress, useNowPlayingTransition } from "@/lib/now-playing-transition";
import { cn } from "@/lib/utils";

/**
 * How long the committed incoming cover lingers (fading out) after a transition
 * ends, covering the controller's resting crossfade + cover resolution so the old
 * cover never flashes through during the hand-off. A touch longer than the
 * background crossfade to absorb the new cover's resolve gap.
 */
const TRANSITION_HANDOFF_MS = 420;

/**
 * Drag-follow crossfade for the blur background, Phase 4 — synced to the
 * foreground via the shared Transition channel. While a transition is active it
 * paints the FROZEN incoming cover (`toCoverUrl`) over the controller's resting
 * (from) cover, with opacity driven straight off `transitionProgress` (the same
 * normalized progress the foreground card uses) — so the background reaches the
 * incoming cover exactly when the card lands (fixes 图1), and the frozen endpoint
 * means it never re-points at a third track mid-commit (fixes 图3). Sits at the
 * resting cover level (flow/visualizer composite over it just like the resting
 * layer), and is invisible when no transition is active (purely additive).
 *
 * Opacity is written imperatively from the MotionValue — no per-frame React.
 */
export function TransitionBackground({
  blurPx,
  maxOpacity = 1,
  className,
}: {
  blurPx: number;
  maxOpacity?: number;
  className?: string;
}) {
  const active = useNowPlayingTransition((s) => s.active);
  const toCoverUrl = useNowPlayingTransition((s) => s.toCoverUrl);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [drawn, setDrawn] = useState(false);

  // Draw the (frozen) incoming cover whenever it changes.
  useEffect(() => {
    setDrawn(false);
    imgRef.current = null;
    if (!toCoverUrl) return;
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
    image.src = toCoverUrl;
    return () => {
      cancelled = true;
    };
  }, [toCoverUrl, blurPx]);

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

  // Drive opacity from the shared transition progress, off the React render path.
  // Only visible while a transition is active and the incoming cover has drawn.
  const visible = active && drawn;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (visible) {
      // Follow the drag imperatively — no CSS transition (it would lag the finger).
      canvas.style.transition = "none";
      const apply = (p: number) => {
        canvas.style.opacity = String(p * maxOpacity);
      };
      apply(transitionProgress.get());
      return transitionProgress.on("change", apply);
    }
    // The transition ended. Don't drop instantly — that reveals the controller's
    // resting layer still mid-crossfade (or still holding the old cover while the
    // new one resolves), flashing the old cover for a frame. Fade out over the
    // handoff window (ease-out holds it high first) so the controller settles on
    // the new cover UNDERNEATH before this layer clears. (QA #1.)
    canvas.style.transition = `opacity ${TRANSITION_HANDOFF_MS}ms ease-out`;
    canvas.style.opacity = "0";
  }, [visible, maxOpacity]);

  return (
    <div
      ref={hostRef}
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ opacity: 0 }} />
    </div>
  );
}
