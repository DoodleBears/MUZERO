import type { AppSettings } from "@/db/types";
import { resolveTheme } from "@/theme/theme";

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

/** Resolved per-line styling for the synced-lyrics view. Pure data. */
export interface LyricStyle {
  /** Active (current) line font size in px. */
  activeFontSize: number;
  /** Inactive line font size in px. */
  inactiveFontSize: number;
  /** Active line opacity, 0–1. */
  activeOpacity: number;
  /** Inactive line opacity, 0–1. */
  inactiveOpacity: number;
  /** CSS color for the lyrics; undefined → inherit the foreground color. */
  color?: string;
  /** Horizontal alignment of the lyric lines. */
  align: "left" | "center" | "right";
  /** CSS text-shadow for the lyrics ("none" when disabled). */
  textShadow: string;
  /** CSS `-webkit-text-stroke` value for the lyrics ("" when disabled). */
  textStroke: string;
  /** Vertical gap between lyric lines, in px. */
  lineGap: number;
}

export const DEFAULT_LYRIC_STYLE: LyricStyle = {
  activeFontSize: 30,
  inactiveFontSize: 24,
  activeOpacity: 1,
  inactiveOpacity: 0.4,
  align: "center",
  textShadow: "0px 2px 8px rgba(0, 0, 0, 0.5)",
  textStroke: "",
  lineGap: 8,
};

const COVER_COLOR_ADJUSTMENT_DEFAULT = 100;
const COVER_COLOR_BRIGHTNESS_DARK_DEFAULT = 150;
const COVER_COLOR_BRIGHTNESS_LIGHT_DEFAULT = 50;
const COVER_COLOR_ADJUSTMENT_MIN = 0;
const COVER_COLOR_ADJUSTMENT_MAX = 200;

function clampPx(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(64, Math.max(12, value));
}

function clampNum(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number | undefined, fallbackPct: number): number {
  const pct = value == null || !Number.isFinite(value) ? fallbackPct : value;
  return Math.min(1, Math.max(0, pct / 100));
}

export interface LyricsCoverColorTuning {
  saturation: number;
  brightness: number;
  contrast: number;
}

export function resolveLyricsCoverColorTuning(settings: AppSettings): LyricsCoverColorTuning {
  return {
    saturation: clampNum(
      settings.lyricsCoverColorSaturation,
      COVER_COLOR_ADJUSTMENT_DEFAULT,
      COVER_COLOR_ADJUSTMENT_MIN,
      COVER_COLOR_ADJUSTMENT_MAX,
    ),
    brightness: clampNum(
      settings.lyricsCoverColorBrightness,
      defaultLyricsCoverColorBrightness(settings),
      COVER_COLOR_ADJUSTMENT_MIN,
      COVER_COLOR_ADJUSTMENT_MAX,
    ),
    contrast: clampNum(
      settings.lyricsCoverColorContrast,
      COVER_COLOR_ADJUSTMENT_DEFAULT,
      COVER_COLOR_ADJUSTMENT_MIN,
      COVER_COLOR_ADJUSTMENT_MAX,
    ),
  };
}

function defaultLyricsCoverColorBrightness(settings: AppSettings): number {
  return resolveTheme(settings.theme ?? "dark") === "light"
    ? COVER_COLOR_BRIGHTNESS_LIGHT_DEFAULT
    : COVER_COLOR_BRIGHTNESS_DARK_DEFAULT;
}

/**
 * Resolve lyric styling from settings + the (optional) cover-derived color.
 * Color modes: "default" inherits the foreground, "cover" uses the spectrum
 * cover color (reuses the visualizer's extraction), "custom" uses a hex. Pure
 * so it's unit-tested without the DOM/store.
 */
export function resolveLyricStyle(settings: AppSettings, coverColorCss: string | null): LyricStyle {
  const mode = settings.lyricsColorMode ?? "default";
  const color =
    mode === "cover"
      ? resolveCoverLyricColor(settings, coverColorCss)
      : mode === "custom"
        ? settings.lyricsCustomColor || undefined
        : undefined;
  return {
    activeFontSize: clampPx(settings.lyricsActiveFontSize, DEFAULT_LYRIC_STYLE.activeFontSize),
    inactiveFontSize: clampPx(
      settings.lyricsInactiveFontSize,
      DEFAULT_LYRIC_STYLE.inactiveFontSize,
    ),
    activeOpacity: clamp01(settings.lyricsActiveOpacity, 100),
    inactiveOpacity: clamp01(settings.lyricsInactiveOpacity, 40),
    color,
    align: settings.lyricsAlign ?? DEFAULT_LYRIC_STYLE.align,
    textShadow: resolveTextShadow(settings),
    textStroke: resolveTextStroke(settings, coverColorCss),
    lineGap: clampNum(settings.lyricsLineGap, DEFAULT_LYRIC_STYLE.lineGap, 0, 48),
  };
}

/** Build the CSS text-shadow from the offset/blur/strength settings. */
function resolveTextShadow(settings: AppSettings): string {
  const opacity = clamp01(settings.lyricsShadowOpacity, 50);
  if (opacity <= 0) return "none";
  const x = clampNum(settings.lyricsShadowOffsetX, 0, -32, 32);
  const y = clampNum(settings.lyricsShadowOffsetY, 2, -32, 32);
  const blur = clampNum(settings.lyricsShadowBlur, 8, 0, 48);
  return `${x}px ${y}px ${blur}px rgba(0, 0, 0, ${opacity})`;
}

function resolveCoverLyricColor(
  settings: AppSettings,
  coverColorCss: string | null,
): string | undefined {
  if (!coverColorCss) return undefined;
  const { saturation, brightness, contrast } = resolveLyricsCoverColorTuning(settings);
  if (
    saturation === COVER_COLOR_ADJUSTMENT_DEFAULT &&
    brightness === COVER_COLOR_ADJUSTMENT_DEFAULT &&
    contrast === COVER_COLOR_ADJUSTMENT_DEFAULT
  ) {
    return coverColorCss;
  }
  const rgb = parseCssRgb(coverColorCss);
  if (!rgb) return coverColorCss;

  const hsl = rgbToHsl(rgb);
  const saturated = hslToRgb({
    ...hsl,
    s: clampNum(hsl.s * (saturation / 100), hsl.s, 0, 1),
  });
  const adjusted = {
    r: applyContrast(saturated.r * (brightness / 100), contrast / 100),
    g: applyContrast(saturated.g * (brightness / 100), contrast / 100),
    b: applyContrast(saturated.b * (brightness / 100), contrast / 100),
  };
  return formatRgb(adjusted);
}

function applyContrast(channel: number, factor: number): number {
  return (channel - 128) * factor + 128;
}

function parseCssRgb(raw: string): Rgb | null {
  const value = raw.trim();
  const hex = parseHexColor(value);
  if (hex) return hex;

  const match = value.match(/^rgba?\((.+)\)$/i);
  if (!match) return null;
  const channels = match[1].split("/")[0].trim();
  const parts = channels.includes(",")
    ? channels.split(",").map((part) => part.trim())
    : channels.split(/\s+/);
  if (parts.length < 3) return null;
  const [r, g, b] = parts.slice(0, 3).map(parseColorChannel);
  if (r == null || g == null || b == null) return null;
  return { r, g, b };
}

function parseHexColor(value: string): Rgb | null {
  const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function parseColorChannel(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const pct = value.endsWith("%");
  const n = Number.parseFloat(pct ? value.slice(0, -1) : value);
  if (!Number.isFinite(n)) return null;
  return pct ? clampRgb((n / 100) * 255) : clampRgb(n);
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const value = clampRgb(l * 255);
    return { r: value, g: value, b: value };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: clampRgb(hueToRgb(p, q, h + 1 / 3) * 255),
    g: clampRgb(hueToRgb(p, q, h) * 255),
    b: clampRgb(hueToRgb(p, q, h - 1 / 3) * 255),
  };
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function formatRgb(rgb: Rgb): string {
  return `rgb(${clampRgb(rgb.r)}, ${clampRgb(rgb.g)}, ${clampRgb(rgb.b)})`;
}

function clampRgb(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * Build the CSS `-webkit-text-stroke` value (width + color) from the outline
 * settings. Returns "" when there'd be no visible outline (width 0 or fully
 * transparent) so the caller can skip the property entirely. The fill is painted
 * on top (paint-order: stroke) so the outline never thins the glyph. The color
 * source mirrors the text color: "cover" reuses the visualizer's cover color
 * (any CSS format), "custom" uses the hex. Pure → unit-tested without the DOM.
 */
function resolveTextStroke(settings: AppSettings, coverColorCss: string | null): string {
  const width = clampNum(settings.lyricsStrokeWidth, 0, 0, 12);
  if (width <= 0) return "";
  const opacity = clamp01(settings.lyricsStrokeOpacity, 100);
  if (opacity <= 0) return "";
  const custom = settings.lyricsStrokeColor || "#000000";
  // "cover" → cover color, falling back to the custom hex when no cover is loaded.
  const base =
    (settings.lyricsStrokeColorMode ?? "custom") === "cover" ? (coverColorCss ?? custom) : custom;
  return `${width}px ${withAlpha(base, opacity)}`;
}

/**
 * Apply an alpha (0–1) to any CSS color. Uses `color-mix` so it works regardless
 * of the input format (hex, rgb(a), the cover color) — at full opacity the color
 * passes through untouched.
 */
function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
