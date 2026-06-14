/**
 * Decode an image source to an `ImageBitmap` for direct GPU upload. Feeding Pixi
 * an ImageBitmap (instead of an HTMLImageElement) skips the "ImageSource: Image
 * element passed, converting to canvas and replacing resource" main-thread copy
 * Pixi does on first render, and `createImageBitmap` decodes off the main thread.
 * The full-resolution source is kept — no downsampling (that's the cover-quality
 * PRD's job). See now-playing-switch-background-perf PRD Phase 4.
 *
 * Pure + injectable (`fetchBlob` / `createImageBitmap`) so it unit-tests without a
 * browser; the caller wires the real `getAppFetch`-backed fetch and the global
 * `createImageBitmap`, and falls back to the <img> path when this returns null.
 */
export interface ImageBitmapTextureSource {
  bitmap: ImageBitmap;
  bytes: number;
  width: number;
  height: number;
  mime?: string;
  /** Release the decoded bitmap's memory — call when the texture is swapped out. */
  unload: () => void;
}

export interface LoadImageBitmapDeps {
  /** Resolve the source URL to its raw bytes (remote via app fetch; blob:/data: via fetch). */
  fetchBlob: (src: string) => Promise<Blob | null>;
  /** Injected for tests; the caller passes the global when supported, else undefined. */
  createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
}

export async function loadImageBitmapSource(
  src: string,
  deps: LoadImageBitmapDeps,
): Promise<ImageBitmapTextureSource | null> {
  const create = deps.createImageBitmap;
  // No off-thread decoder available → let the caller fall back to the <img> path.
  if (typeof create !== "function") return null;
  try {
    const blob = await deps.fetchBlob(src);
    if (!blob || blob.size === 0) return null;
    const bitmap = await create(blob);
    return {
      bitmap,
      bytes: blob.size,
      width: bitmap.width,
      height: bitmap.height,
      mime: blob.type || undefined,
      unload: () => bitmap.close(),
    };
  } catch {
    // Corrupt/undecodable source or fetch failure — fall back to the <img> path.
    return null;
  }
}
