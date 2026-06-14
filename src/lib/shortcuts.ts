import type { Tab } from "@/components/nav/dock-nav";

/**
 * Keyboard-shortcut helpers for the nav row. Pure (no React, no DOM) so the
 * mapping is unit-tested and the NavRow component stays thin.
 */

/** Tabs addressable by Cmd/Ctrl+1..3, in nav-FAB order: playback · gallery · settings. */
export const SHORTCUT_TABS = ["now", "search", "settings"] as const satisfies readonly Tab[];

/** Map a top-row digit ("1".."3") to its tab, or null for anything else. */
export function tabForShortcutKey(key: string): Tab | null {
  const index = Number(key) - 1;
  return Number.isInteger(index) && index >= 0 && index < SHORTCUT_TABS.length
    ? SHORTCUT_TABS[index]
    : null;
}

export type TabCycleDirection = 1 | -1;

/** Resolve the next/previous primary nav tab, wrapping around the shortcut order. */
export function tabForCycleShortcut(current: Tab, direction: TabCycleDirection): Tab {
  const index = SHORTCUT_TABS.indexOf(current as (typeof SHORTCUT_TABS)[number]);
  if (index < 0) {
    return direction > 0 ? SHORTCUT_TABS[0] : SHORTCUT_TABS[SHORTCUT_TABS.length - 1];
  }
  const nextIndex = (index + direction + SHORTCUT_TABS.length) % SHORTCUT_TABS.length;
  return SHORTCUT_TABS[nextIndex];
}

/** macOS shows ⌘; every other platform shows Ctrl. */
export function modifierSymbol(mac: boolean): string {
  return mac ? "⌘" : "Ctrl";
}

/** Best-effort macOS detection for shortcut hints (display only). */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = navigator.platform || navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/.test(p);
}

/** Best-effort Windows detection — smooth scroll defaults on there (heavy lists). */
export function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = navigator.platform || navigator.userAgent || "";
  return /Win/i.test(p);
}
