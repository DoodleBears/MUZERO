/**
 * Global light / dark / system theme.
 *
 * Mirrors the locale approach (see src/i18n/config.ts): localStorage
 * (`muzero-theme`) is the synchronous source of truth read at boot — an inline
 * script in index.html applies the right `.dark` class before first paint to
 * avoid a flash — and `AppSettings.theme` in IndexedDB is the mirrored copy.
 * "system" follows the OS `prefers-color-scheme` and updates live.
 */

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** The two concrete schemes a theme resolves to. */
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: Theme = "system";
export const THEME_STORAGE_KEY = "muzero-theme";

/** theme-color meta values, kept in sync so the mobile chrome matches. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#09090b",
};

export const themes: Array<{ value: Theme; labelKey: `settings.theme${Capitalize<Theme>}` }> = [
  { value: "system", labelKey: "settings.themeSystem" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEMES.includes(value as Theme);
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolve "system" to a concrete light/dark using the OS preference. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

/** Read the startup theme: stored preference → default ("system"). */
export function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

/** Reflect a theme on the document: toggle `.dark` + sync the theme-color meta. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[resolved]);
}

/** Persist the chosen theme and apply it immediately. */
export function persistTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

/**
 * Apply the stored theme on boot and keep "system" mode tracking the OS. The
 * inline script in index.html paints the initial class; this re-applies once the
 * app loads and wires the live OS-preference listener.
 */
export function initTheme(): void {
  if (typeof window === "undefined") return;
  applyTheme(readStoredTheme());
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (readStoredTheme() === "system") applyTheme("system");
  });
}
