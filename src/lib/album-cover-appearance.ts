import type { AppSettings } from "@/db/types";

export const ALBUM_COVER_APPEARANCE_DEFAULTS = {
  radius: 12,
  shadowOpacity: 55,
  shadowBlur: 16,
  shadowOffsetX: 0,
  shadowOffsetY: 4,
};

export interface AlbumCoverAppearance {
  radius: number;
  shadowOpacity: number;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

export function albumCoverAppearanceCssVars(
  settings: Partial<AppSettings>,
): Record<string, string> {
  return albumCoverAppearanceVars(resolveAlbumCoverAppearance(settings));
}

export function albumCoverAppearanceVars(appearance: AlbumCoverAppearance): Record<string, string> {
  return {
    "--album-cover-radius": `${appearance.radius}px`,
    "--album-cover-shadow": albumCoverShadowCss(appearance),
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

export function resolveAlbumCoverRadius(value: AppSettings["albumCoverRadius"]): number {
  return clamp(value, 0, 32, ALBUM_COVER_APPEARANCE_DEFAULTS.radius);
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
