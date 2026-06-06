import type { Tab } from "@/components/nav/dock-nav";

/**
 * Keyboard-shortcut helpers for the nav row. Pure (no React, no DOM) so the
 * mapping is unit-tested and the NavRow component stays thin.
 */

/** Tabs addressable by Cmd/Ctrl+1..4, in NavRow order (no "now" — that's the player area). */
export const SHORTCUT_TABS = [
  "queue",
  "search",
  "sessions",
  "settings",
] as const satisfies readonly Tab[];

/** Map a top-row digit ("1".."4") to its tab, or null for anything else. */
export function tabForShortcutKey(key: string): Tab | null {
  const index = Number(key) - 1;
  return Number.isInteger(index) && index >= 0 && index < SHORTCUT_TABS.length
    ? SHORTCUT_TABS[index]
    : null;
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
