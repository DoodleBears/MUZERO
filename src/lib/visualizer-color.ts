/**
 * Shared color helpers for the visualizer renderers. Extracted from the original
 * aura visualizer so every spectrum style derives its palette from the live
 * `--primary` accent (see src/theme/primary.ts) the same way.
 */

export type Rgb = { r: number; g: number; b: number };

/** Brand purple #bf83fe — fallback when `--primary` can't be resolved. */
export const FALLBACK_RGB: Rgb = { r: 191, g: 131, b: 254 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Mix a color toward white (0 = unchanged, 1 = white) for bright cores/rings. */
export function lighten({ r, g, b }: Rgb, amount: number): Rgb {
  const a = clamp01(amount);
  return {
    r: Math.round(r + (255 - r) * a),
    g: Math.round(g + (255 - g) * a),
    b: Math.round(b + (255 - b) * a),
  };
}

/** Mix a color toward black (0 = unchanged, 1 = black) for shadowed falloff. */
export function darken({ r, g, b }: Rgb, amount: number): Rgb {
  const a = clamp01(amount);
  return { r: Math.round(r * (1 - a)), g: Math.round(g * (1 - a)), b: Math.round(b * (1 - a)) };
}

/** A CSS `rgba()` string from an Rgb + alpha. */
export const rgba = ({ r, g, b }: Rgb, a: number): string => `rgba(${r}, ${g}, ${b}, ${a})`;

/** Reused 1×1 scratch canvas for resolving CSS colors to sRGB (see colorToRgb). */
let scratch: CanvasRenderingContext2D | null = null;

/**
 * Resolve any CSS color string (hex / rgb / named / oklch) to true sRGB by
 * rasterizing one pixel and reading it back. A `fillStyle` *string* round-trip
 * isn't enough — some WebViews echo `oklch()` back verbatim. Returns null for an
 * invalid value (caught via a sentinel it'd overwrite) or when no 2D context is
 * available (e.g. jsdom in tests).
 */
export function colorToRgb(raw: string): Rgb | null {
  if (typeof document === "undefined") return null;
  if (!scratch) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    scratch = c.getContext("2d", { willReadFrequently: true });
  }
  const ctx = scratch;
  if (!ctx) return null;
  ctx.fillStyle = "#010203"; // sentinel: survives if `raw` is rejected
  ctx.fillStyle = raw;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  if (r === 1 && g === 2 && b === 3) return null;
  return { r, g, b };
}

/**
 * Read the live `--primary` token (the accent the user picks in Settings) as RGB,
 * so visualizers track it regardless of color space. Falls back to brand purple.
 */
export function readPrimaryRgb(): Rgb {
  if (typeof document === "undefined") return FALLBACK_RGB;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  return (raw && colorToRgb(raw)) || FALLBACK_RGB;
}
