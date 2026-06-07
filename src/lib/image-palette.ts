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

/**
 * Lightweight browser-side dominant color extraction. Anysoul uses
 * `node-vibrant/browser`; MUZERO keeps this local and dependency-free because
 * cover colors are only used as a live visual accent.
 */
export async function extractDominantImageColor(blob: Blob): Promise<Rgb | null> {
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
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return selectDominantImageColor(pixels);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function selectDominantImageColor(pixels: Uint8ClampedArray | number[]): Rgb | null {
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

  let best: Bucket | null = null;
  let bestScore = -Infinity;
  for (const bucket of buckets.values()) {
    const sat = bucket.saturation / bucket.count;
    const light = bucket.lightness / bucket.count;
    const lightBalance = 1 - Math.abs(light - 0.52);
    const score = bucket.count * (0.65 + sat * 1.4) * Math.max(0.25, lightBalance);
    if (score > bestScore) {
      best = bucket;
      bestScore = score;
    }
  }

  if (!best) return null;
  return {
    r: clampChannel(best.r / best.count),
    g: clampChannel(best.g / best.count),
    b: clampChannel(best.b / best.count),
  };
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
