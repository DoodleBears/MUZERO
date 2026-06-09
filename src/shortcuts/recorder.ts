/**
 * Pure helpers for the "press your keys" recorder UI: which chords to warn about
 * (OS/browser-reserved), and whether a recorded stroke is complete. No React, no
 * DOM — the stateful capture (buffering held modifiers, committing on a non-modifier
 * key) lives in the recorder component; this is the testable decision layer.
 */

import type { Platform, ShortcutGesture } from "./registry";

/** Single-key chords with the primary modifier that the OS/browser usually claims. */
const RESERVED_PRIMARY_CODES = new Set([
  "KeyW", // close window/tab
  "KeyR", // reload
  "KeyN", // new window
  "KeyT", // new tab
  "KeyP", // print
  "KeyL", // focus address bar
  "KeyQ", // quit (mac)
]);

export type ShortcutWarning = "browser-reserved";

/**
 * Warn (don't block) when a chord is a bare primary-modifier combo the OS/browser
 * reserves (e.g. ⌘W close window) — the renderer can't reliably override these, so
 * the binding may simply never fire. Modifier-augmented variants (⌘⇧W) are not
 * flagged.
 */
export function reservedWarning(
  gesture: ShortcutGesture,
  platform: Platform,
): ShortcutWarning | null {
  if (gesture.kind !== "key") return null;
  const s = gesture.stroke;
  if (s.altKey || s.shiftKey) return null;
  const isPrimary = !!s.primaryKey || !!s.metaKey || (!!s.ctrlKey && platform !== "mac");
  if (!isPrimary) return null;
  return RESERVED_PRIMARY_CODES.has(s.code) ? "browser-reserved" : null;
}

/** A key event that finalizes a chord (anything but a bare modifier press). */
export function isModifierOnlyKey(key: string): boolean {
  return key === "Alt" || key === "Control" || key === "Meta" || key === "Shift";
}
