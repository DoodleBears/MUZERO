/**
 * Information architecture for the two-column Settings page: sections (sidebar
 * group headers) → items (the actual panes). Kept as a pure config + resolver so
 * the id set and stale-id fallback are unit-tested without React. Item labels
 * reuse existing card-title i18n keys where possible; section headers add a small
 * set of `navSec*` keys.
 *
 * Cloud Drive stays as one scan-friendly pane; stale split-pane ids are aliased
 * below so a persisted sidebar selection never drops the user into a dead pane.
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
      { id: "flow", labelKey: "settings.navFlow" },
      { id: "lyrics", labelKey: "settings.navLyrics" },
    ],
  },
  {
    labelKey: "settings.navSecPlayback",
    items: [
      { id: "playback-dj", labelKey: "settings.djTitle" },
      { id: "playback-music", labelKey: "settings.musicTitle" },
      { id: "stream-sources", labelKey: "streamSources.title" },
      { id: "storage", labelKey: "streamCache.permanentTitle" },
    ],
  },
  {
    labelKey: "settings.navSecKeyboard",
    items: [{ id: "shortcuts", labelKey: "settings.navShortcuts" }],
  },
  {
    labelKey: "settings.navSecCloud",
    items: [
      { id: "cloud", labelKey: "settings.cloudDriveTitle" },
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
  {
    labelKey: "settings.navSecAbout",
    items: [
      { id: "about", labelKey: "settings.navAbout" },
      { id: "version-history", labelKey: "settings.navVersionHistory" },
    ],
  },
] as const satisfies readonly SettingsNavSection[];

const SETTINGS_ITEM_ALIASES: Record<string, string> = {
  "cloud-owner": "cloud",
  "cloud-sync": "cloud",
};

export function settingsItemIds(nav: readonly SettingsNavSection[] = SETTINGS_NAV): string[] {
  return nav.flatMap((section) => section.items.map((item) => item.id));
}

/** Return `active` if it's a known item id, else the first item (stale fallback). */
export function resolveActiveSettingsItem(
  active: string,
  nav: readonly SettingsNavSection[] = SETTINGS_NAV,
): string {
  const ids = settingsItemIds(nav);
  const candidate = SETTINGS_ITEM_ALIASES[active] ?? active;
  return ids.includes(candidate) ? candidate : (ids[0] ?? candidate);
}
