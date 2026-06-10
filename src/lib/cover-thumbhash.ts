import { rgbaToThumbHash } from "thumbhash";
import type { CropRect } from "@/db/types";
import { log } from "@/lib/logger";

/**
 * Cover thumbhash generation (instant-cover-thumbnails PRD Phase 3).
 *
 * Decodes a cover blob (optionally just its crop rect) to a small RGBA buffer and
 * encodes a base64 thumbhash — the ~25-byte blurred preview stored on the owner
 * row (`Track.coverThumbhash` etc.) and shown instantly before the cover loads.
 *
 * Runs on the main thread at cover-set time (a rare user action, cheap to decode
 * a single small image). Browser-only (`createImageBitmap` + canvas); every path
 * is guarded so a cover-set NEVER fails just because a preview couldn't be made —
 * on any failure (no canvas, decode error, tainted) it resolves to `undefined`
 * and the UI falls back to the calm `bg-secondary` block.
 */

/** Longest edge of the buffer we feed the encoder (thumbhash caps at 100px). */
const MAX_EDGE = 96;

export function thumbhashToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToThumbhash(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Generate a base64 thumbhash for a cover image, framed by `crop` when given so
 * the preview matches what the user sees. Resolves `undefined` on any failure.
 */
export async function encodeCoverThumbhash(
  blob: Blob,
  crop?: CropRect,
): Promise<string | undefined> {
  try {
    if (typeof createImageBitmap !== "function") return undefined;
    const bitmap = await createImageBitmap(blob);
    try {
      // Source rect: the crop (clamped to the image) or the whole image.
      const sx = crop ? Math.max(0, Math.min(crop.x, bitmap.width)) : 0;
      const sy = crop ? Math.max(0, Math.min(crop.y, bitmap.height)) : 0;
      const sw = crop ? Math.max(1, Math.min(crop.width, bitmap.width - sx)) : bitmap.width;
      const sh = crop ? Math.max(1, Math.min(crop.height, bitmap.height - sy)) : bitmap.height;

      // Scale the source rect down so its longest edge is ≤ MAX_EDGE.
      const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
      const dw = Math.max(1, Math.round(sw * scale));
      const dh = Math.max(1, Math.round(sh * scale));

      const ctx = make2dContext(dw, dh);
      if (!ctx) return undefined;
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
      const { data } = ctx.getImageData(0, 0, dw, dh);
      return thumbhashToBase64(rgbaToThumbHash(dw, dh, data));
    } finally {
      bitmap.close();
    }
  } catch (err) {
    log.debug("cover thumbhash encode failed; skipping preview", err);
    return undefined;
  }
}

/** A 2D context backed by OffscreenCanvas when available, else a DOM canvas. */
function make2dContext(
  w: number,
  h: number,
): (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) | null {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas.getContext("2d", { willReadFrequently: true });
  }
  return null;
}
