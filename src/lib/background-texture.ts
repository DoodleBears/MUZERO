/**
 * Decode an image source to an `ImageBitmap` for direct GPU upload. Feeding Pixi
 * an ImageBitmap (instead of an HTMLImageElement) skips the "ImageSource: Image
 * element passed, converting to canvas and replacing resource" main-thread copy
 * Pixi does on first render, and `createImageBitmap` decodes off the main thread.
 * The caller may pass a background-only max dimension. That downsamples just the
 * ambient Pixi texture before GPU upload; stage art and coverflow keep their
 * original quality. See now-playing-switch-background-perf PRD Phase 15.
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
  sourceWidth?: number;
  sourceHeight?: number;
  resizeMaxDimension?: number;
  /** Release the decoded bitmap's memory — call when the texture is swapped out. */
  unload: () => void;
}

export type ImageBitmapLoadStage = "fetch" | "header" | "decode";

export interface ImageBitmapLoadStageContext {
  category: "performance";
  durationMs: number;
  phase: "success" | "skip" | "fail";
  bytes?: number;
  errorKind?: "network_error" | "media_decode" | "unknown";
  height?: number;
  mime?: string;
  reason?: string;
  resizeAttempted?: boolean;
  resizeHeight?: number;
  resizeMaxDimension?: number;
  resizeWidth?: number;
  retryWithoutResize?: boolean;
  sourceHeight?: number;
  sourceWidth?: number;
  width?: number;
}

export interface LoadImageBitmapDeps {
  /** Resolve the source URL to its raw bytes (remote via app fetch; blob:/data: via fetch). */
  fetchBlob: (src: string) => Promise<Blob | null>;
  /** Injected for tests; the caller passes the global when supported, else undefined. */
  createImageBitmap?: (blob: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>;
  /** Optional background texture budget; oversized image sources decode to this max side. */
  maxDimension?: number;
  /** Optional trace hook; the Pixi caller wires this to diagnostic logs. */
  onStage?: (stage: ImageBitmapLoadStage, context: ImageBitmapLoadStageContext) => void;
  /** Injected clock for deterministic timing tests. */
  now?: () => number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

const IMAGE_DIMENSION_HEADER_BYTES = 64 * 1024;
const IMAGE_BITMAP_RESIZE_QUALITY: ResizeQuality = "high";

export async function loadImageBitmapSource(
  src: string,
  deps: LoadImageBitmapDeps,
): Promise<ImageBitmapTextureSource | null> {
  const create = deps.createImageBitmap;
  // No off-thread decoder available → let the caller fall back to the <img> path.
  if (typeof create !== "function") return null;
  const now = deps.now ?? nowMs;
  const emitStage = (
    stage: ImageBitmapLoadStage,
    startedAt: number,
    context: Omit<ImageBitmapLoadStageContext, "category" | "durationMs">,
  ) => {
    deps.onStage?.(stage, {
      category: "performance",
      durationMs: roundMs(now() - startedAt),
      ...context,
    });
  };
  try {
    const fetchStartedAt = now();
    let blob: Blob | null;
    try {
      blob = await deps.fetchBlob(src);
    } catch (error) {
      emitStage("fetch", fetchStartedAt, {
        errorKind: "network_error",
        phase: "fail",
      });
      throw error;
    }
    if (!blob || blob.size === 0) {
      emitStage("fetch", fetchStartedAt, {
        bytes: blob?.size ?? 0,
        mime: blob?.type || undefined,
        phase: "skip",
        reason: blob ? "empty-blob" : "missing-blob",
      });
      return null;
    }
    emitStage("fetch", fetchStartedAt, {
      bytes: blob.size,
      mime: blob.type || undefined,
      phase: "success",
    });

    const headerStartedAt = now();
    const sourceDimensions = await readImageDimensions(blob).catch(() => null);
    const resize = resolveResizeOptions(sourceDimensions, deps.maxDimension);
    emitStage("header", headerStartedAt, {
      bytes: blob.size,
      mime: blob.type || undefined,
      phase: sourceDimensions ? "success" : "skip",
      reason: sourceDimensions ? undefined : "unknown-dimensions",
      resizeHeight: resize?.options.resizeHeight,
      resizeMaxDimension: resize?.maxDimension,
      resizeWidth: resize?.options.resizeWidth,
      sourceHeight: sourceDimensions?.height,
      sourceWidth: sourceDimensions?.width,
    });

    let appliedResize = resize;
    let bitmap: ImageBitmap;
    const decodeStartedAt = now();
    let retryWithoutResize = false;
    try {
      bitmap = resize ? await create(blob, resize.options) : await create(blob);
    } catch (error) {
      if (!resize) {
        emitStage("decode", decodeStartedAt, {
          bytes: blob.size,
          errorKind: "media_decode",
          mime: blob.type || undefined,
          phase: "fail",
          resizeAttempted: false,
          sourceHeight: sourceDimensions?.height,
          sourceWidth: sourceDimensions?.width,
        });
        throw error;
      }
      // Some WebViews expose createImageBitmap but not resize options. Preserve
      // the off-thread ImageBitmap path by retrying without the optional budget.
      retryWithoutResize = true;
      try {
        bitmap = await create(blob);
      } catch (retryError) {
        emitStage("decode", decodeStartedAt, {
          bytes: blob.size,
          errorKind: "media_decode",
          mime: blob.type || undefined,
          phase: "fail",
          resizeAttempted: true,
          retryWithoutResize,
          sourceHeight: sourceDimensions?.height,
          sourceWidth: sourceDimensions?.width,
        });
        throw retryError;
      }
      appliedResize = null;
    }
    emitStage("decode", decodeStartedAt, {
      bytes: blob.size,
      height: bitmap.height,
      mime: blob.type || undefined,
      phase: "success",
      resizeAttempted: Boolean(resize),
      resizeHeight: appliedResize?.options.resizeHeight,
      resizeMaxDimension: appliedResize?.maxDimension,
      resizeWidth: appliedResize?.options.resizeWidth,
      retryWithoutResize,
      sourceHeight: sourceDimensions?.height,
      sourceWidth: sourceDimensions?.width,
      width: bitmap.width,
    });
    return {
      bitmap,
      bytes: blob.size,
      width: bitmap.width,
      height: bitmap.height,
      mime: blob.type || undefined,
      resizeMaxDimension: appliedResize?.maxDimension,
      sourceHeight: sourceDimensions?.height,
      sourceWidth: sourceDimensions?.width,
      unload: () => bitmap.close(),
    };
  } catch {
    // Corrupt/undecodable source or fetch failure — fall back to the <img> path.
    return null;
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveResizeOptions(
  dimensions: ImageDimensions | null,
  maxDimension: number | undefined,
): { maxDimension: number; options: ImageBitmapOptions } | null {
  if (!dimensions || !Number.isFinite(maxDimension) || !maxDimension) return null;
  const budget = Math.max(1, Math.floor(maxDimension));
  const sourceMax = Math.max(dimensions.width, dimensions.height);
  if (sourceMax <= budget) return null;
  const scale = budget / sourceMax;
  return {
    maxDimension: budget,
    options: {
      resizeHeight: Math.max(1, Math.round(dimensions.height * scale)),
      resizeQuality: IMAGE_BITMAP_RESIZE_QUALITY,
      resizeWidth: Math.max(1, Math.round(dimensions.width * scale)),
    },
  };
}

async function readImageDimensions(blob: Blob): Promise<ImageDimensions | null> {
  const header = new Uint8Array(await blob.slice(0, IMAGE_DIMENSION_HEADER_BYTES).arrayBuffer());
  return readPngDimensions(header) ?? readJpegDimensions(header) ?? readWebpDimensions(header);
}

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a ||
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return validDimensions(view.getUint32(16), view.getUint32(20));
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2) return null;
    const payloadOffset = offset + 2;
    const segmentEnd = offset + length;
    if (segmentEnd > bytes.length) return null;
    if (isJpegStartOfFrame(marker)) {
      if (length < 7) return null;
      const height = (bytes[payloadOffset + 1] << 8) | bytes[payloadOffset + 2];
      const width = (bytes[payloadOffset + 3] << 8) | bytes[payloadOffset + 4];
      return validDimensions(width, height);
    }
    offset = segmentEnd;
  }
  return null;
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 30 ||
    bytes[0] !== 0x52 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = readAscii(bytes, offset, 4);
    const chunkSize = readUint32Le(bytes, offset + 4);
    const payloadOffset = offset + 8;
    if (payloadOffset + chunkSize > bytes.length) return null;

    if (chunk === "VP8X" && chunkSize >= 10) {
      return validDimensions(
        1 + readUint24Le(bytes, payloadOffset + 4),
        1 + readUint24Le(bytes, payloadOffset + 7),
      );
    }
    if (chunk === "VP8L" && chunkSize >= 5 && bytes[payloadOffset] === 0x2f) {
      const bits =
        bytes[payloadOffset + 1] |
        (bytes[payloadOffset + 2] << 8) |
        (bytes[payloadOffset + 3] << 16) |
        (bytes[payloadOffset + 4] << 24);
      return validDimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
    }
    if (
      chunk === "VP8 " &&
      chunkSize >= 10 &&
      bytes[payloadOffset + 3] === 0x9d &&
      bytes[payloadOffset + 4] === 0x01 &&
      bytes[payloadOffset + 5] === 0x2a
    ) {
      const width = readUint16Le(bytes, payloadOffset + 6) & 0x3fff;
      const height = readUint16Le(bytes, payloadOffset + 8) & 0x3fff;
      return validDimensions(width, height);
    }

    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }
  return null;
}

function validDimensions(width: number, height: number): ImageDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }
  return { width, height };
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return result;
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
  );
}
