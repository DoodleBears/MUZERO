import type { CropRect } from "@/db/types";

/** Load an object-URL into an HTMLImageElement. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Render a crop region of an image blob to a new blob via canvas. Used only for
 * *display* — the original is always kept, so this is non-destructive. Falls
 * back to the source blob if anything goes wrong (no canvas, decode failure).
 */
export async function getCroppedBlob(source: Blob, rect: CropRect, mime?: string): Promise<Blob> {
  if (typeof document === "undefined") return source;
  const url = URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return source;
    ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime || source.type || "image/jpeg", 0.92),
    );
    return out ?? source;
  } catch {
    return source;
  } finally {
    URL.revokeObjectURL(url);
  }
}
