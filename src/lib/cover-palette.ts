import { thumbHashToAverageRGBA } from "thumbhash";
import type { CropRect } from "@/db/types";
import { base64ToThumbhash } from "@/lib/cover-thumbhash";
import { getCroppedBlob } from "@/lib/image-crop";
import { extractImagePalette } from "@/lib/image-palette";
import type { Rgb } from "@/lib/visualizer-color";

const COVER_PALETTE_MAX_COLORS = 4;

export interface CoverPaletteFields {
  coverPalette?: Rgb[];
  coverPaletteSource?: string;
}

export async function extractCoverPalette(
  blob: Blob,
  crop?: CropRect,
  mime = blob.type,
): Promise<Rgb[]> {
  try {
    const contentType = normalizeImageMime(mime);
    if (!contentType) return [];
    const typedBlob = blob.type === contentType ? blob : blob.slice(0, blob.size, contentType);
    const sampled = crop ? await getCroppedBlob(typedBlob, crop, contentType) : typedBlob;
    return normalizeCoverPalette(await extractImagePalette(sampled, COVER_PALETTE_MAX_COLORS));
  } catch {
    return [];
  }
}

export function coverPaletteFields(palette: readonly Rgb[] | undefined, source?: string) {
  const clean = normalizeCoverPalette(palette);
  return {
    coverPalette: clean.length > 0 ? clean : undefined,
    coverPaletteSource: clean.length > 0 ? source : undefined,
  } satisfies CoverPaletteFields;
}

export function normalizeCoverPalette(palette: readonly Rgb[] | undefined | null): Rgb[] {
  if (!palette) return [];
  const clean: Rgb[] = [];
  for (const rgb of palette) {
    const color = normalizeRgb(rgb);
    if (!color) continue;
    if (clean.some((existing) => sameRgb(existing, color))) continue;
    clean.push(color);
    if (clean.length >= COVER_PALETTE_MAX_COLORS) break;
  }
  return clean;
}

export function coverPaletteFromThumbhash(thumbhash: string | undefined): Rgb[] {
  if (!thumbhash) return [];
  try {
    const average = thumbHashToAverageRGBA(base64ToThumbhash(thumbhash));
    if (average.a < 0.05) return [];
    return [normalizeRgb({ r: average.r * 255, g: average.g * 255, b: average.b * 255 })].filter(
      (rgb): rgb is Rgb => Boolean(rgb),
    );
  } catch {
    return [];
  }
}

function normalizeRgb(rgb: Rgb | undefined | null): Rgb | null {
  if (!rgb) return null;
  const r = clampChannel(rgb.r);
  const g = clampChannel(rgb.g);
  const b = clampChannel(rgb.b);
  return r == null || g == null || b == null ? null : { r, g, b };
}

function clampChannel(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function sameRgb(a: Rgb, b: Rgb): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

function normalizeImageMime(value: string | undefined): string | undefined {
  const mime = value?.split(";")[0]?.trim().toLowerCase();
  if (!mime?.startsWith("image/")) return undefined;
  return mime === "image/jpg" ? "image/jpeg" : mime;
}
