import type { AppSettings } from "@/db/types";

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
      ? (coverColorCss ?? undefined)
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
