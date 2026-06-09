import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from "react";
import type { Tab } from "@/components/nav/dock-nav";
import { AudioLinesIcon } from "@/components/ui/audio-lines";
import { Disc3Icon } from "@/components/ui/disc-3";
import { SettingsIcon } from "@/components/ui/settings";

export interface AnimatedNavIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

type AnimatedIcon = ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & { size?: number } & RefAttributes<AnimatedNavIconHandle>
>;

export interface NavFabItem {
  id: Exclude<Tab, "queue" | "sessions">;
  labelKey: "now" | "sets" | "settings";
  icon: AnimatedIcon;
}

/**
 * The three destinations of the merged nav FAB: playback · 歌单 gallery · settings.
 * Queue lives inside Now Playing; sets are browsed in the gallery; the AI helper
 * is its own draggable FAB. Order matches SHORTCUT_TABS (Cmd/Ctrl+1..3).
 */
export const NAV_ITEMS: NavFabItem[] = [
  { id: "now", labelKey: "now", icon: AudioLinesIcon },
  { id: "search", labelKey: "sets", icon: Disc3Icon },
  { id: "settings", labelKey: "settings", icon: SettingsIcon },
];
