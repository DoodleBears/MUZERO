import type { AppSettings } from "@/db/types";

export const NOW_PLAYING_COVER_EFFECT_MODES = ["shadow", "backlight", "off"] as const;

export const ALBUM_COVER_APPEARANCE_DEFAULTS = {
  radius: 12,
  shadowOpacity: 55,
  shadowBlur: 16,
  shadowOffsetX: 0,
  shadowOffsetY: 4,
  nowPlayingCoverEffectMode: "shadow" as const,
  backlightOpacity: 50,
  backlightRange: 13,
  backlightBlur: 12,
  backlightSaturation: 330,
};

export interface AlbumCoverAppearance {
  radius: number;
  shadowOpacity: number;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

export interface NowPlayingCoverBacklightAppearance {
  opacity: number;
  range: number;
  blur: number;
  saturation: number;
}

export function albumCoverAppearanceCssVars(
  settings: Partial<AppSettings>,
): Record<string, string> {
  return {
    ...albumCoverAppearanceVars(resolveAlbumCoverAppearance(settings)),
    ...nowPlayingCoverBacklightVars(resolveNowPlayingCoverBacklightAppearance(settings)),
  };
}

export function albumCoverAppearanceVars(appearance: AlbumCoverAppearance): Record<string, string> {
  return {
    "--album-cover-radius": `${appearance.radius}px`,
    "--album-cover-shadow": albumCoverShadowCss(appearance),
  };
}

export function nowPlayingCoverBacklightVars(
  appearance: NowPlayingCoverBacklightAppearance,
): Record<string, string> {
  return {
    "--now-playing-cover-backlight-opacity": String(appearance.opacity / 100),
    "--now-playing-cover-backlight-scale": String(1 + appearance.range / 100),
    "--now-playing-cover-backlight-blur": `${appearance.blur}px`,
    "--now-playing-cover-backlight-saturation": `${appearance.saturation}%`,
  };
}

export function resolveAlbumCoverAppearance(settings: Partial<AppSettings>): AlbumCoverAppearance {
  return {
    radius: resolveAlbumCoverRadius(settings.albumCoverRadius),
    shadowOpacity: clamp(
      settings.albumCoverShadowOpacity,
      0,
      100,
      ALBUM_COVER_APPEARANCE_DEFAULTS.shadowOpacity,
    ),
    shadowBlur: clamp(
      settings.albumCoverShadowBlur,
      0,
      48,
      ALBUM_COVER_APPEARANCE_DEFAULTS.shadowBlur,
    ),
    shadowOffsetX: clamp(
      settings.albumCoverShadowOffsetX,
      -32,
      32,
      ALBUM_COVER_APPEARANCE_DEFAULTS.shadowOffsetX,
    ),
    shadowOffsetY: clamp(
      settings.albumCoverShadowOffsetY,
      -32,
      32,
      ALBUM_COVER_APPEARANCE_DEFAULTS.shadowOffsetY,
    ),
  };
}

export function resolveNowPlayingCoverBacklightAppearance(
  settings: Partial<AppSettings>,
): NowPlayingCoverBacklightAppearance {
  return {
    opacity: clamp(
      settings.nowPlayingCoverBacklightOpacity,
      0,
      100,
      ALBUM_COVER_APPEARANCE_DEFAULTS.backlightOpacity,
    ),
    range: clamp(
      settings.nowPlayingCoverBacklightRange,
      0,
      40,
      ALBUM_COVER_APPEARANCE_DEFAULTS.backlightRange,
    ),
    blur: clamp(
      settings.nowPlayingCoverBacklightBlur,
      0,
      64,
      ALBUM_COVER_APPEARANCE_DEFAULTS.backlightBlur,
    ),
    saturation: clamp(
      settings.nowPlayingCoverBacklightSaturation,
      100,
      600,
      ALBUM_COVER_APPEARANCE_DEFAULTS.backlightSaturation,
    ),
  };
}

export function resolveAlbumCoverRadius(value: AppSettings["albumCoverRadius"]): number {
  return clamp(value, 0, 32, ALBUM_COVER_APPEARANCE_DEFAULTS.radius);
}

export function resolveNowPlayingCoverEffectMode(
  value: AppSettings["nowPlayingCoverEffectMode"],
): (typeof NOW_PLAYING_COVER_EFFECT_MODES)[number] {
  return value === "backlight" || value === "off"
    ? value
    : ALBUM_COVER_APPEARANCE_DEFAULTS.nowPlayingCoverEffectMode;
}

/**
 * Whether the now-playing cover backlight derivative is actually needed. Only the
 * "backlight" effect mode renders it; the default "shadow" (and "off") must NOT
 * request it — otherwise every track switch fires a worker render + DB write +
 * blob URL for an image that is never shown (audit O1). Gate the
 * `useCoverDerivativeUrl(..., "backlight")` call on this so it skips by default.
 */
export function shouldRequestCoverBacklightDerivative(
  mode: (typeof NOW_PLAYING_COVER_EFFECT_MODES)[number],
  enabled: boolean,
): boolean {
  return enabled && mode === "backlight";
}

function albumCoverShadowCss(appearance: AlbumCoverAppearance): string {
  if (appearance.shadowOpacity <= 0) return "none";
  return [
    `${appearance.shadowOffsetX}px`,
    `${appearance.shadowOffsetY}px`,
    `${appearance.shadowBlur}px`,
    `rgb(0 0 0 / ${appearance.shadowOpacity}%)`,
  ].join(" ");
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return clamp(fallback, min, max, min);
  return Math.min(max, Math.max(min, Number(value)));
}
