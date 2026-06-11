/**
 * Alternate desktop app icons the user can switch between (Electron only). Two
 * built-in variants today — the dark tile (default) and the light tile, the same
 * pair the theme-aware favicon uses. Pure registry so the id set + labels are
 * unit-tested without React; the runtime swap lives in the desktop bridge
 * (`setAppIcon`) → Electron main (`electron/app-icon.cjs`), and the apply-on-boot
 * hook in `src/hooks/use-app-icon.ts`.
 *
 * Note: this changes the RUNNING dock / taskbar icon only. The installed bundle
 * icon (Finder / Launchpad / installer) is baked from the dark logo at build
 * time (`build/icon.icns` + `build/icon.png`) and changes only on rebuild.
 */

export const APP_ICONS = ["dark", "light"] as const;
export type AppIconId = (typeof APP_ICONS)[number];

export const DEFAULT_APP_ICON: AppIconId = "dark";

export function isAppIconId(value: unknown): value is AppIconId {
  return typeof value === "string" && (APP_ICONS as readonly string[]).includes(value);
}

/** Normalize a stored/unknown value to a valid icon id (stale-value fallback). */
export function resolveAppIcon(value: unknown): AppIconId {
  return isAppIconId(value) ? value : DEFAULT_APP_ICON;
}

/** Picker rows: id → i18n label key + the public preview image shown as a swatch. */
export const APP_ICON_OPTIONS: ReadonlyArray<{
  value: AppIconId;
  labelKey: `settings.appIcon${Capitalize<AppIconId>}`;
  preview: string;
}> = [
  { value: "dark", labelKey: "settings.appIconDark", preview: "/muzero-logo-dark.png" },
  { value: "light", labelKey: "settings.appIconLight", preview: "/muzero-logo-light.png" },
];
