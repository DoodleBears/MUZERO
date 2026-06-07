/**
 * Per-mode brand/primary color.
 *
 * The user picks a primary (accent) color for light mode and dark mode
 * independently (Settings → Appearance). We apply it by injecting a single
 * managed <style> element that overrides the `--primary` / `--ring` /
 * `--primary-foreground` tokens for `:root` (light) and `.dark` — so the CSS
 * cascade swaps colors automatically when the theme class toggles, with no
 * JS re-apply needed on theme change.
 *
 * Like the theme (see [[theme]] / src/theme/theme.ts), localStorage is the
 * synchronous source of truth read at boot, mirrored to AppSettings in IndexedDB.
 */

export interface PrimaryColors {
  /** Hex used as `--primary` in light mode. */
  light: string;
  /** Hex used as `--primary` in dark mode. */
  dark: string;
}

/**
 * Default accent = the "neon" preset: electric indigo (#5b23ff) on white, acid
 * yellow (#e4ff30) on near-black. Injected over the neutral-purple base in
 * styles.css by initPrimary() before first paint, so fresh installs start neon.
 * Keep in sync with the "neon" entry in PRIMARY_PRESETS below.
 */
export const DEFAULT_PRIMARY: PrimaryColors = { light: "#5b23ff", dark: "#e4ff30" };

export type PrimaryPresetId =
  | "ocean"
  | "teal"
  | "matcha"
  | "neon"
  | "synthwave"
  | "nebula"
  | "rose"
  | "sunset";

/**
 * A named two-color preset: the darker/saturated color goes to light mode (so
 * its button text reads on white), the lighter/brighter to dark mode (so the
 * accent pops on a near-black surface). One tap sets both.
 *
 * Pairs follow accessible-color best practice (Radix Colors / Tailwind
 * 600→400): an accent that passes on white loses contrast on dark, so dark mode
 * needs a lighter variant of the hue. Every pair is WCAG AA on its button.
 */
export interface PrimaryPreset {
  id: PrimaryPresetId;
  colors: PrimaryColors;
}

export const PRIMARY_PRESETS: PrimaryPreset[] = [
  { id: "ocean", colors: { light: "#2c5ead", dark: "#1591dc" } },
  { id: "teal", colors: { light: "#0d9488", dark: "#2dd4bf" } },
  { id: "matcha", colors: { light: "#285a48", dark: "#b0e4cc" } },
  { id: "neon", colors: { light: "#5b23ff", dark: "#e4ff30" } },
  { id: "synthwave", colors: { light: "#792ca2", dark: "#c13383" } },
  { id: "nebula", colors: { light: "#443199", dark: "#c13383" } },
  { id: "rose", colors: { light: "#e11d48", dark: "#fb7185" } },
  { id: "sunset", colors: { light: "#d97706", dark: "#fbbf24" } },
];

export const PRIMARY_LIGHT_KEY = "muzero-primary-light";
export const PRIMARY_DARK_KEY = "muzero-primary-dark";

const STYLE_ID = "muzero-primary";
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

/** Expand #rgb → #rrggbb and lowercase. Assumes `isHexColor` already passed. */
export function normalizeHex(hex: string): string {
  const h = hex.toLowerCase();
  if (h.length === 4) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return h;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** WCAG relative luminance (0 = black, 1 = white). */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: number, b: number): number {
  return a >= b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05);
}

/** Near-black foreground (avoids pure #000 halation per dark-mode guidance). */
const FG_DARK = "#0a0a0a";
const FG_LIGHT = "#ffffff";
const FG_DARK_LUM = relativeLuminance(FG_DARK);

/**
 * Readable foreground (text/icon) to sit on top of `hex`: pick whichever of
 * white / near-black has the higher WCAG contrast ratio. This is more correct
 * than a single luminance threshold — light accents (mint, amber) get dark text,
 * saturated mid-tones get white — so every accent meets AA on its button.
 */
export function contrastForeground(hex: string): string {
  const L = relativeLuminance(hex);
  return contrastRatio(L, 1) >= contrastRatio(L, FG_DARK_LUM) ? FG_LIGHT : FG_DARK;
}

/** Read the startup primary colors: stored preference → brand default. */
export function readStoredPrimary(): PrimaryColors {
  if (typeof window === "undefined") return DEFAULT_PRIMARY;
  const light = window.localStorage.getItem(PRIMARY_LIGHT_KEY);
  const dark = window.localStorage.getItem(PRIMARY_DARK_KEY);
  return {
    light: isHexColor(light) ? normalizeHex(light) : DEFAULT_PRIMARY.light,
    dark: isHexColor(dark) ? normalizeHex(dark) : DEFAULT_PRIMARY.dark,
  };
}

/** Inject/update the managed <style> that overrides the primary tokens per mode. */
export function applyPrimary(colors: PrimaryColors): void {
  if (typeof document === "undefined") return;
  const block = (sel: string, c: string) =>
    `${sel}{--primary:${c};--ring:${c};--primary-foreground:${contrastForeground(c)};}`;
  const css = `${block(":root", colors.light)}\n${block(".dark", colors.dark)}`;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    // Appended last so it wins over the base :root / .dark rules in styles.css.
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/** Persist the chosen colors and apply them immediately. */
export function persistPrimary(colors: PrimaryColors): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PRIMARY_LIGHT_KEY, colors.light);
  window.localStorage.setItem(PRIMARY_DARK_KEY, colors.dark);
  applyPrimary(colors);
}

/** Apply the stored primary colors on boot (called before first render). */
export function initPrimary(): void {
  applyPrimary(readStoredPrimary());
}
