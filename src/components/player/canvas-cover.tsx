import { useEffect, useLayoutEffect, useRef } from "react";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";

// Shared pool of already-DECODED cover images, keyed by url, across every CanvasCover
// instance (base + the three coverflow cards). A freshly-mounted overlay card creating
// its own `new Image()` isn't synchronously `complete` even for a cached url — so the
// drag-start card would still wait a frame to paint = the flash. But the base is already
// displaying the current cover, so its decoded image is in this pool; the centre card
// draws that SAME bitmap synchronously (before paint) = no flash. LRU-capped so it only
// retains the handful of on-screen covers (current + neighbours), not the whole library.
const DECODED_POOL_MAX = 12;
const decodedPool = new Map<string, HTMLImageElement>();

function poolGet(url: string): HTMLImageElement | undefined {
  const img = decodedPool.get(url);
  if (img) {
    decodedPool.delete(url);
    decodedPool.set(url, img); // bump to most-recently-used
  }
  return img;
}

function poolSet(url: string, img: HTMLImageElement): void {
  decodedPool.delete(url);
  decodedPool.set(url, img);
  if (decodedPool.size > DECODED_POOL_MAX) {
    const oldest = decodedPool.keys().next().value;
    if (oldest !== undefined) decodedPool.delete(oldest);
  }
}

/**
 * The Now Playing cover, rendered to a PERSISTENT pair of canvases instead of a DOM
 * <img> — the same reason the Pixi background never flashes:
 *
 *  - A cached cover (the common case — covers are preloaded) is drawn SYNCHRONOUSLY in a
 *    layout effect, BEFORE the browser paints the frame in which this card mounts / the
 *    base hides. So the overlay card is never an empty `bg-muted` square for a frame =
 *    no "drag-start 闪黑". Opacity is flipped imperatively (not via React state, which
 *    would only apply a render later — re-introducing the gap).
 *  - The canvases never unmount and their pixels are never evicted, so a cover switch
 *    can't re-decode-on-paint: the previous cover stays on canvas A while the next is
 *    drawn into canvas B, then they crossfade.
 *  - An UNCACHED cover (a far jump) falls back to async `decode()` then reveal — the only
 *    case with a brief placeholder, because the bytes genuinely aren't here yet.
 *
 * `onShown` fires once the new cover is actually painted (drives the coverflow handoff
 * gate). The first (cold) paint snaps in; a later switch crossfades over `crossfadeSec`.
 */
export function CanvasCover({
  coverUrl,
  className,
  crossfadeSec = 0.2,
  onShown,
  label,
}: {
  coverUrl: string | null;
  className?: string;
  crossfadeSec?: number;
  /** Fired with the painted url once it is drawn (the new cover is visible). */
  onShown?: (url: string) => void;
  /** Diagnostic tag (e.g. "base" / "card-current") so a copy-trace can tell the
   *  flash window of each cover apart. No effect on rendering. */
  label?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasARef = useRef<HTMLCanvasElement | null>(null);
  const canvasBRef = useRef<HTMLCanvasElement | null>(null);
  const activeIndexRef = useRef(0);
  const hasFrameRef = useRef(false);
  // The decoded image on the ACTIVE canvas — kept so a resize can repaint it.
  const frameRef = useRef<HTMLImageElement | null>(null);
  // Ref-stable so a new closure per render doesn't re-run the decode effect.
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  const labelRef = useRef(label);
  labelRef.current = label;
  const crossfadeRef = useRef(crossfadeSec);
  crossfadeRef.current = crossfadeSec;

  // Both canvases start hidden. Opacity is owned IMPERATIVELY from here on (never via a
  // style prop) so a parent re-render can't clobber a freshly-revealed canvas back to 0.
  useLayoutEffect(() => {
    if (canvasARef.current) canvasARef.current.style.opacity = "0";
    if (canvasBRef.current) canvasBRef.current.style.opacity = "0";
  }, []);

  useLayoutEffect(() => {
    if (!coverUrl) return;
    let cancelled = false;
    // The window between this effect and `reveal` is the FLASH window. A pooled/cached
    // cover reveals synchronously below (elapsedMs≈0); only a never-decoded one waits.
    const startedAt = performance.now();
    const cold = !hasFrameRef.current;

    const reveal = (img: HTMLImageElement, sync: boolean, fromPool: boolean) => {
      if (cancelled || !img.naturalWidth) return;
      const a = canvasARef.current;
      const b = canvasBRef.current;
      if (!a || !b) return;
      // Draw into the INACTIVE canvas (the active one still shows the previous cover),
      // then flip opacity — the previous fades out as the fresh one fades in.
      const nextIndex = hasFrameRef.current ? 1 - activeIndexRef.current : activeIndexRef.current;
      const nextCanvas = nextIndex === 0 ? a : b;
      const prevCanvas = nextIndex === 0 ? b : a;
      drawCoverFrame(nextCanvas, img);
      // Cold (first) paint snaps in — no fade up from the empty surface; a real switch
      // crossfades the two covers.
      const fade = hasFrameRef.current ? crossfadeRef.current : 0;
      nextCanvas.style.transition = `opacity ${fade}s ease-out`;
      prevCanvas.style.transition = `opacity ${fade}s ease-out`;
      nextCanvas.style.opacity = "1";
      prevCanvas.style.opacity = "0";
      frameRef.current = img;
      hasFrameRef.current = true;
      activeIndexRef.current = nextIndex;
      poolSet(coverUrl, img);
      onShownRef.current?.(coverUrl);
      log.debug("nowplaying.cover", "paint", {
        label: labelRef.current ?? "cover",
        elapsedMs: Math.round(performance.now() - startedAt),
        cold,
        fromPool,
        sync,
      });
    };

    // 1) Already decoded by another CanvasCover (e.g. the base showing this cover) → draw
    //    that SAME bitmap synchronously, before the browser paints this frame. No flash.
    const pooled = poolGet(coverUrl);
    if (pooled?.complete && pooled.naturalWidth > 0) {
      reveal(pooled, true, true);
      return () => {
        cancelled = true;
      };
    }

    // 2) Not pooled — decode our own. Sync-draw if the memory cache happens to make it
    //    complete this tick; otherwise await decode() (the only path that can flash, and
    //    only for a never-seen cover — a real far jump).
    const image = new Image();
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.src = coverUrl;
    if (image.complete && image.naturalWidth > 0) {
      reveal(image, true, false);
    } else if (typeof image.decode === "function") {
      image.decode().then(
        () => reveal(image, false, false),
        () => {
          if (!cancelled && image.complete && image.naturalWidth > 0) reveal(image, false, false);
        },
      );
    } else {
      image.onload = () => reveal(image, false, false);
    }
    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  // Repaint the active canvas at the new size on resize (canvas pixels don't reflow).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const image = frameRef.current;
      const canvas = activeIndexRef.current === 0 ? canvasARef.current : canvasBRef.current;
      if (image && canvas) drawCoverFrame(canvas, image);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className={cn("absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
    >
      <canvas ref={canvasARef} className="absolute inset-0 h-full w-full" />
      <canvas ref={canvasBRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

/** Draw `image` to fill `canvas` with object-fit:cover (centre-crop), at device pixels. */
function drawCoverFrame(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
  const dpr = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);
  const cssW = Math.max(1, canvas.clientWidth);
  const cssH = Math.max(1, canvas.clientHeight);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!ctx || !iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
