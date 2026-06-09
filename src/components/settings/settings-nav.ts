/**
 * Information architecture for the two-column Settings page: sections (sidebar
 * group headers) → items (the actual panes). Kept as a pure config + resolver so
 * the id set and stale-id fallback are unit-tested without React. Item labels
 * reuse existing card-title i18n keys where possible; section headers add a small
 * set of `navSec*` keys.
 *
 * Phase 3 keeps Cloud Drive as a single `cloud` item; Phase 4 splits it into
 * `cloud-owner` / `cloud-subscribe` / `cloud-sync` / `cloud-presence`.
 */
export interface SettingsNavItem {
  id: string;
  labelKey: string;
}

export interface SettingsNavSection {
  labelKey: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV = [
  {
    labelKey: "settings.navSecAppearance",
    items: [
      { id: "appearance", labelKey: "settings.appearance" },
      { id: "background", labelKey: "settings.navBackground" },
      { id: "visualizer", labelKey: "settings.navVisualizer" },
    ],
  },
  {
    labelKey: "settings.navSecPlayback",
    items: [
      { id: "playback-dj", labelKey: "settings.djTitle" },
      { id: "playback-music", labelKey: "settings.musicTitle" },
    ],
  },
  {
    labelKey: "settings.navSecCloud",
    items: [
      { id: "cloud-owner", labelKey: "settings.navCloudOwner" },
      { id: "cloud-subscribe", labelKey: "settings.navCloudSubscribe" },
      { id: "cloud-sync", labelKey: "settings.navCloudSync" },
      { id: "cloud-presence", labelKey: "settings.navCloudPresence" },
    ],
  },
  {
    labelKey: "settings.navSecDevice",
    items: [{ id: "device", labelKey: "settings.deviceTitle" }],
  },
  {
    labelKey: "settings.navSecAdvanced",
    items: [{ id: "advanced", labelKey: "settings.traceTitle" }],
  },
] as const satisfies readonly SettingsNavSection[];

export function settingsItemIds(nav: readonly SettingsNavSection[] = SETTINGS_NAV): string[] {
  return nav.flatMap((section) => section.items.map((item) => item.id));
}

/** Return `active` if it's a known item id, else the first item (stale fallback). */
export function resolveActiveSettingsItem(
  active: string,
  nav: readonly SettingsNavSection[] = SETTINGS_NAV,
): string {
  const ids = settingsItemIds(nav);
  return ids.includes(active) ? active : (ids[0] ?? active);
}
