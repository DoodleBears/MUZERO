import type { Rgb } from "@/lib/visualizer-color";

const SAMPLE_MAX_DIM = 96;
const QUANTIZE_STEP = 16;

type Bucket = {
  count: number;
  r: number;
  g: number;
  b: number;
  saturation: number;
  lightness: number;
};

/** Default palette size — dedup usually yields 2–4 useful swatches anyway. */
const DEFAULT_PALETTE_COUNT = 4;
/** Two swatches closer than this (sRGB euclidean) collapse into one — keeps a
 *  palette from being five shades of the same purple. */
const MIN_SWATCH_DISTANCE = 64;

/**
 * Lightweight browser-side cover color extraction. Anysoul uses
 * `node-vibrant/browser`; MUZERO keeps this local and dependency-free because
 * cover colors only drive a live visual accent (single dominant) and the
 * flow background (a small multi-color palette).
 */
export async function extractImagePalette(
  blob: Blob,
  count = DEFAULT_PALETTE_COUNT,
): Promise<Rgb[]> {
  const pixels = await sampleImagePixels(blob);
  return pixels ? selectImagePalette(pixels, count) : [];
}

/** Single dominant color — the most prominent entry of {@link extractImagePalette}. */
export async function extractDominantImageColor(blob: Blob): Promise<Rgb | null> {
  return (await extractImagePalette(blob, 1))[0] ?? null;
}

/** Decode + downsample an image Blob to raw RGBA pixels (null if unsupported). */
async function sampleImagePixels(blob: Blob): Promise<Uint8ClampedArray | null> {
  if (typeof document === "undefined" || !blob.type.startsWith("image/")) return null;

  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return null;

    const scale = Math.min(1, SAMPLE_MAX_DIM / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Extract up to `count` distinct, prominent chromatic swatches from raw RGBA
 * pixels — most dominant first. White/black/gray-heavy pixels are skipped so the
 * palette stays vivid, and near-duplicate swatches are merged. Returns `[]` when
 * the art has no usable chromatic color (transparent / neutral-only).
 */
export function selectImagePalette(
  pixels: Uint8ClampedArray | number[],
  count = DEFAULT_PALETTE_COUNT,
): Rgb[] {
  const buckets = new Map<string, Bucket>();

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] ?? 255;
    if (a < 160) continue;

    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    const { saturation, lightness } = rgbToHsl(r, g, b);

    // White/black/gray-heavy album art is common; skip it so the visualizer does
    // not collapse into low-contrast neutral bars.
    if (lightness < 0.1 || lightness > 0.94 || saturation < 0.12) continue;

    const qr = quantize(r);
    const qg = quantize(g);
    const qb = quantize(b);
    const key = `${qr}:${qg}:${qb}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.saturation += saturation;
      bucket.lightness += lightness;
    } else {
      buckets.set(key, { count: 1, r, g, b, saturation, lightness });
    }
  }

  // Average + score every bucket, then take the strongest, skipping any swatch
  // too close to one already chosen (greedy dedup over score-sorted buckets).
  const scored = Array.from(buckets.values())
    .map((bucket) => {
      const sat = bucket.saturation / bucket.count;
      const light = bucket.lightness / bucket.count;
      const lightBalance = 1 - Math.abs(light - 0.52);
      return {
        rgb: {
          r: clampChannel(bucket.r / bucket.count),
          g: clampChannel(bucket.g / bucket.count),
          b: clampChannel(bucket.b / bucket.count),
        },
        score: bucket.count * (0.65 + sat * 1.4) * Math.max(0.25, lightBalance),
      };
    })
    .sort((a, b) => b.score - a.score);

  const palette: Rgb[] = [];
  for (const { rgb } of scored) {
    if (palette.length >= count) break;
    if (palette.every((picked) => rgbDistance(picked, rgb) >= MIN_SWATCH_DISTANCE)) {
      palette.push(rgb);
    }
  }
  return palette;
}

/** Single dominant color (pure) — the first entry of {@link selectImagePalette}. */
export function selectDominantImageColor(pixels: Uint8ClampedArray | number[]): Rgb | null {
  return selectImagePalette(pixels, 1)[0] ?? null;
}

function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function quantize(value: number): number {
  return Math.round(value / QUANTIZE_STEP) * QUANTIZE_STEP;
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function rgbToHsl(r: number, g: number, b: number): { saturation: number; lightness: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { saturation, lightness };
}
