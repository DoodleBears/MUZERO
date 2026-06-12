import type { AppSettings } from "@/db/types";

export type ElectronWindowBorderColorMode = "cover" | "custom";

export const ELECTRON_WINDOW_APPEARANCE_DEFAULTS = {
  radius: 12,
  borderWidth: 6,
  borderColorMode: "cover" as ElectronWindowBorderColorMode,
  borderColor: "#ffffff",
  borderOpacity: 10,
};

export function electronWindowAppearanceCssVars(
  settings: Partial<AppSettings>,
  options: { coverColorCss?: string | null } = {},
): Record<string, string> {
  const radius = clamp(
    settings.electronWindowRadius,
    0,
    32,
    ELECTRON_WINDOW_APPEARANCE_DEFAULTS.radius,
  );
  const borderWidth = clamp(
    settings.electronWindowBorderWidth,
    0,
    8,
    ELECTRON_WINDOW_APPEARANCE_DEFAULTS.borderWidth,
  );
  const borderColor = cssColorWithOpacity(
    resolveBorderColor(settings, options.coverColorCss),
    settings.electronWindowBorderOpacity ?? ELECTRON_WINDOW_APPEARANCE_DEFAULTS.borderOpacity,
  );

  return {
    "--electron-window-radius": `${radius}px`,
    "--electron-window-border-width": `${borderWidth}px`,
    "--electron-window-border-color": borderColor,
  };
}

export function resolveBorderColorMode(
  value: AppSettings["electronWindowBorderColorMode"],
): ElectronWindowBorderColorMode {
  return value === "cover" || value === "custom"
    ? value
    : ELECTRON_WINDOW_APPEARANCE_DEFAULTS.borderColorMode;
}

function resolveBorderColor(
  settings: Partial<AppSettings>,
  coverColorCss: string | null | undefined,
): string {
  const customColor =
    settings.electronWindowBorderColor ?? ELECTRON_WINDOW_APPEARANCE_DEFAULTS.borderColor;
  return resolveBorderColorMode(settings.electronWindowBorderColorMode) === "cover"
    ? (coverColorCss ?? customColor)
    : customColor;
}

function cssColorWithOpacity(color: string, opacity: number): string {
  const pct = clamp(opacity, 0, 100, ELECTRON_WINDOW_APPEARANCE_DEFAULTS.borderOpacity);
  const rgb = parseHex(color);
  if (rgb) return `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${pct}%)`;
  const raw = color.trim();
  if (!raw) {
    const fallback = parseHex(ELECTRON_WINDOW_APPEARANCE_DEFAULTS.borderColor);
    if (!fallback) return "transparent";
    return `rgb(${fallback.r} ${fallback.g} ${fallback.b} / ${pct}%)`;
  }
  if (pct >= 100) return raw;
  return `color-mix(in srgb, ${raw} ${pct}%, transparent)`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return clamp(fallback, min, max, min);
  return Math.min(max, Math.max(min, Number(value)));
}
