/**
 * Information architecture for the two-column Settings page: sections (sidebar
 * group headers) → items (the actual panes). Kept as a pure config + resolver so
 * the id set and stale-id fallback are unit-tested without React. Item labels
 * reuse existing card-title i18n keys where possible; section headers add a small
 * set of `navSec*` keys.
 *
 * Stale ids are aliased below so persisted sidebar selections never drop the user
 * into a dead pane after IA reshuffles.
 */
export interface SettingsNavItem {
  id: string;
  labelKey: string;
  icon: string;
}

export interface SettingsNavSection {
  labelKey: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV = [
  {
    labelKey: "settings.navSecAppearance",
    items: [
      { id: "appearance", labelKey: "settings.appearance", icon: "palette" },
      { id: "background", labelKey: "settings.navBackground", icon: "image" },
      { id: "visualizer", labelKey: "settings.navVisualizer", icon: "audio-lines" },
      { id: "flow", labelKey: "settings.navFlow", icon: "waves" },
      { id: "lyrics", labelKey: "settings.navLyrics", icon: "captions" },
    ],
  },
  {
    labelKey: "settings.navSecFiles",
    items: [
      { id: "local-files", labelKey: "settings.navLocalFiles", icon: "folder-open" },
      { id: "online-sources", labelKey: "streamSources.title", icon: "radio" },
    ],
  },
  {
    labelKey: "settings.navSecStorage",
    items: [{ id: "storage", labelKey: "streamCache.permanentTitle", icon: "hard-drive" }],
  },
  {
    labelKey: "settings.navSecCloud",
    items: [
      { id: "cloud", labelKey: "settings.cloudDriveTitle", icon: "cloud" },
      { id: "cloud-presence", labelKey: "settings.navCloudPresence", icon: "cloud-cog" },
    ],
  },
  {
    labelKey: "settings.navSecAi",
    items: [
      { id: "ai-dj-model", labelKey: "settings.navDjModel", icon: "brain-circuit" },
      { id: "ai-music-generation", labelKey: "settings.musicTitle", icon: "sparkles" },
    ],
  },
  {
    labelKey: "settings.navSecListening",
    items: [
      { id: "listening-stats", labelKey: "settings.navListeningStats", icon: "bar-chart-3" },
    ],
  },
  {
    labelKey: "settings.navSecControls",
    items: [
      { id: "shortcuts", labelKey: "settings.navShortcuts", icon: "keyboard" },
      { id: "playback", labelKey: "settings.navPlayback", icon: "play-circle" },
    ],
  },
  {
    labelKey: "settings.navSecAbout",
    items: [
      { id: "device-profile", labelKey: "settings.deviceTitle", icon: "monitor-smartphone" },
      { id: "desktop-downloads", labelKey: "settings.navDesktopDownloads", icon: "download" },
      { id: "about", labelKey: "settings.navAbout", icon: "info" },
    ],
  },
  {
    labelKey: "settings.navSecAdvanced",
    items: [{ id: "advanced", labelKey: "settings.traceTitle", icon: "activity" }],
  },
] as const satisfies readonly SettingsNavSection[];

const SETTINGS_ITEM_ALIASES: Record<string, string> = {
  "cloud-owner": "cloud",
  "cloud-sync": "cloud",
  device: "device-profile",
  "playback-dj": "ai-dj-model",
  "playback-music": "ai-music-generation",
  "stream-sources": "online-sources",
  "version-history": "desktop-downloads",
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
