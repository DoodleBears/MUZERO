import { rgbaToThumbHash } from "thumbhash";
import type { CropRect } from "@/db/types";
import { normalizeCoverPalette } from "@/lib/cover-palette";
import { selectImagePalette } from "@/lib/image-palette";
import type { Rgb } from "@/lib/visualizer-color";

const SAMPLE_MAX_EDGE = 96;
const DEFAULT_TARGETS = ["palette", "thumbhash"] as const;

export type CoverMetadataTarget = (typeof DEFAULT_TARGETS)[number];

export interface CoverMetadataInput {
  blob: Blob;
  crop?: CropRect;
  mime?: string;
  sourceKey?: string;
  targets?: readonly CoverMetadataTarget[];
}

export interface CoverMetadataTimings {
  decodeMs: number;
  paletteMs: number;
  thumbhashMs: number;
  totalMs: number;
}

export interface CoverMetadataResult {
  palette: Rgb[];
  thumbhash?: string;
  timings: CoverMetadataTimings;
}

interface DecodedPixels {
  data: Uint8ClampedArray;
  height: number;
  width: number;
}

export async function extractCoverMetadataInline(
  input: CoverMetadataInput,
): Promise<CoverMetadataResult> {
  const totalStartedAt = now();
  const timings: CoverMetadataTimings = {
    decodeMs: 0,
    paletteMs: 0,
    thumbhashMs: 0,
    totalMs: 0,
  };
  const targets = new Set(input.targets?.length ? input.targets : DEFAULT_TARGETS);
  const decodeStartedAt = now();
  const decoded = await decodeCoverPixels(input);
  timings.decodeMs = elapsed(decodeStartedAt);

  let palette: Rgb[] = [];
  let thumbhash: string | undefined;

  if (decoded && targets.has("palette")) {
    const paletteStartedAt = now();
    palette = normalizeCoverPalette(selectImagePalette(decoded.data));
    timings.paletteMs = elapsed(paletteStartedAt);
  }

  if (decoded && targets.has("thumbhash")) {
    const thumbhashStartedAt = now();
    thumbhash = bytesToBase64(rgbaToThumbHash(decoded.width, decoded.height, decoded.data));
    timings.thumbhashMs = elapsed(thumbhashStartedAt);
  }

  timings.totalMs = elapsed(totalStartedAt);
  return normalizeCoverMetadataResult({ palette, thumbhash, timings });
}

export function normalizeCoverMetadataResult(
  result: Partial<CoverMetadataResult> | undefined | null,
): CoverMetadataResult {
  const timings = normalizeTimings(result?.timings);
  const thumbhash = typeof result?.thumbhash === "string" ? result.thumbhash.trim() : "";
  return {
    palette: normalizeCoverPalette(result?.palette),
    thumbhash: thumbhash || undefined,
    timings,
  };
}

async function decodeCoverPixels(input: CoverMetadataInput): Promise<DecodedPixels | null> {
  if (typeof createImageBitmap !== "function") return null;
  const contentType = normalizeImageMime(input.mime) ?? normalizeImageMime(input.blob.type);
  if (!contentType) return null;
  const blob =
    input.blob.type === contentType
      ? input.blob
      : input.blob.slice(0, input.blob.size, contentType);
  const bitmap = await createImageBitmap(blob);
  try {
    const source = sourceRect(bitmap.width, bitmap.height, input.crop);
    const scale = Math.min(1, SAMPLE_MAX_EDGE / Math.max(source.sw, source.sh));
    const width = Math.max(1, Math.round(source.sw * scale));
    const height = Math.max(1, Math.round(source.sh * scale));
    const ctx = make2dContext(width, height);
    if (!ctx) return null;
    ctx.drawImage(bitmap, source.sx, source.sy, source.sw, source.sh, 0, 0, width, height);
    return { data: ctx.getImageData(0, 0, width, height).data, height, width };
  } finally {
    bitmap.close();
  }
}

function sourceRect(width: number, height: number, crop?: CropRect) {
  if (!crop) return { sx: 0, sy: 0, sw: width, sh: height };
  const sx = clamp(crop.x, 0, width);
  const sy = clamp(crop.y, 0, height);
  return {
    sx,
    sy,
    sw: Math.max(1, Math.min(crop.width, width - sx)),
    sh: Math.max(1, Math.min(crop.height, height - sy)),
  };
}

function make2dContext(
  width: number,
  height: number,
): (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) | null {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
  }
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d", { willReadFrequently: true });
}

function normalizeTimings(
  timings: Partial<CoverMetadataTimings> | undefined,
): CoverMetadataTimings {
  return {
    decodeMs: roundMs(timings?.decodeMs),
    paletteMs: roundMs(timings?.paletteMs),
    thumbhashMs: roundMs(timings?.thumbhashMs),
    totalMs: roundMs(timings?.totalMs),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
  return btoa(binary);
}

function normalizeImageMime(value: string | undefined): string | undefined {
  const mime = value?.split(";")[0]?.trim().toLowerCase();
  if (!mime?.startsWith("image/")) return undefined;
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function elapsed(startedAt: number): number {
  return roundMs(now() - startedAt);
}

function roundMs(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round((value ?? 0) * 100) / 100) : 0;
}
