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
}

export const DEFAULT_LYRIC_STYLE: LyricStyle = {
  activeFontSize: 24,
  inactiveFontSize: 20,
  activeOpacity: 1,
  inactiveOpacity: 0.4,
  align: "left",
};

function clampPx(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(64, Math.max(12, value));
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
    align: settings.lyricsAlign ?? "left",
  };
}
