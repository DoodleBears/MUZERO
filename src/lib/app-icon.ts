/**
 * Alternate app logos the user can switch between. The same allowlist feeds the
 * browser favicon and the Electron runtime dock/taskbar icon; installed bundle
 * icons (Finder / Launchpad / installer) are still baked at build time.
 */

export const APP_ICONS = ["light", "dark", "sketch", "monogram", "split"] as const;
export type AppIconId = (typeof APP_ICONS)[number];

export const DEFAULT_APP_ICON: AppIconId = "dark";
export const APP_ICON_STORAGE_KEY = "muzero-app-icon";

export function isAppIconId(value: unknown): value is AppIconId {
  return typeof value === "string" && (APP_ICONS as readonly string[]).includes(value);
}

/** Normalize a stored/unknown value to a valid icon id (stale-value fallback). */
export function resolveAppIcon(value: unknown): AppIconId {
  return isAppIconId(value) ? value : DEFAULT_APP_ICON;
}

type AppIconLabelKey =
  | "settings.appIconLight"
  | "settings.appIconDark"
  | "settings.appIconSketch"
  | "settings.appIconMonogram"
  | "settings.appIconSplit";

/** Picker rows: id → i18n label key + the public image used for previews/favicon. */
export const APP_ICON_OPTIONS: ReadonlyArray<{
  value: AppIconId;
  labelKey: AppIconLabelKey;
  preview: string;
}> = [
  { value: "light", labelKey: "settings.appIconLight", preview: "/muzero-logo-light.png" },
  { value: "dark", labelKey: "settings.appIconDark", preview: "/muzero-logo-dark.png" },
  { value: "sketch", labelKey: "settings.appIconSketch", preview: "/muzero-logo.png" },
  { value: "monogram", labelKey: "settings.appIconMonogram", preview: "/muzero-logo-1.png" },
  { value: "split", labelKey: "settings.appIconSplit", preview: "/muzero-logo-2.png" },
];

export function resolveAppIconOption(value: unknown) {
  const icon = resolveAppIcon(value);
  return APP_ICON_OPTIONS.find((option) => option.value === icon) ?? APP_ICON_OPTIONS[0];
}

export function readStoredAppIcon(): AppIconId {
  if (typeof window === "undefined") return DEFAULT_APP_ICON;
  return resolveAppIcon(window.localStorage.getItem(APP_ICON_STORAGE_KEY));
}

export function applyFavicon(appIcon: AppIconId): void {
  if (typeof document === "undefined") return;
  document.getElementById("favicon")?.setAttribute("href", resolveAppIconOption(appIcon).preview);
}

export function persistAppIcon(appIcon: AppIconId): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(APP_ICON_STORAGE_KEY, appIcon);
  applyFavicon(appIcon);
}
