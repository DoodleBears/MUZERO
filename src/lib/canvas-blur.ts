/**
 * Canvas downsample "blur" shared by the ambient backgrounds.
 *
 * Desktop Tauri on macOS uses WKWebView, whose compositor is fragile with
 * full-screen CSS `filter: blur()` on large images. Instead we draw the cover
 * into a tiny offscreen canvas and scale it back up — the upscaling smoothing is
 * the blur, at a fraction of the cost and with no compositor risk. Extracted so
 * both `CanvasBlurBackground` (settled crossfade) and `DragCrossfadeBackground`
 * (drag-follow crossfade, PRD Phase 2-D) share one implementation.
 */

const scratchCanvasByTarget = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** Draw `image` into `canvas`, blurred via downsample-then-upscale. */
export function drawBlurFrame(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number },
  blurPx: number,
): void {
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
  let low = scratchCanvasByTarget.get(canvas);
  if (!low) {
    low = document.createElement("canvas");
    scratchCanvasByTarget.set(canvas, low);
  }
  low.width = sampleW;
  low.height = sampleH;
  const lowCtx = low.getContext("2d");
  if (!lowCtx) return;

  lowCtx.imageSmoothingEnabled = true;
  lowCtx.imageSmoothingQuality = "high";
  drawImageCover(lowCtx, image, sampleW, sampleH);
  ctx.drawImage(low, 0, 0, sampleW, sampleH, 0, 0, w, h);
}

/** Draw `img` into `ctx` with object-fit: cover semantics. */
export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number },
  width: number,
  height: number,
): void {
  const naturalWidth = img.naturalWidth ?? width;
  const naturalHeight = img.naturalHeight ?? height;
  const scale = Math.max(width / naturalWidth, height / naturalHeight);
  const drawW = naturalWidth * scale;
  const drawH = naturalHeight * scale;
  const x = (width - drawW) / 2;
  const y = (height - drawH) / 2;
  ctx.drawImage(img, x, y, drawW, drawH);
}
