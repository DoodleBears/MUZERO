/**
 * Warm the browser's decoded-image cache for a cover URL off the main thread, so
 * the <img> that later paints it doesn't decode the full-resolution image
 * synchronously on the rasterization path (the per-switch cost in the
 * now-playing-switch-background-perf PRD, Phase 5). The original image is kept —
 * this only moves the decode off the paint path, it doesn't downsample.
 *
 * Fire-and-forget: a rejected or absent `decode()` is swallowed (the <img> just
 * decodes on paint as before). Injectable image factory so it unit-tests without
 * a DOM; defaults to the global `Image`, and is a no-op where none exists.
 */
export interface WarmDecodeImage {
  decode?: () => Promise<unknown>;
  decoding: string;
  referrerPolicy: string;
  src: string;
}

export type CreateWarmImage = () => WarmDecodeImage;

export function warmDecode(
  url: string,
  createImage: CreateWarmImage | null = defaultCreateImage(),
): void {
  if (!createImage) return;
  const img = createImage();
  img.decoding = "async";
  // Streamed covers come from third-party hosts that 403 a foreign referer.
  img.referrerPolicy = "no-referrer";
  img.src = url;
  void img.decode?.()?.catch(() => {});
}

function defaultCreateImage(): CreateWarmImage | null {
  if (typeof Image === "undefined") return null;
  return () => new Image();
}
