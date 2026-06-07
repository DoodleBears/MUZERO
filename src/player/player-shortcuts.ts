/**
 * Pure keyboard-shortcut resolver for player transport. No DOM, no store — maps a
 * key event to an intent, so the mapping is exhaustively unit-tested and the hook
 * that wires it to the store + DOM stays thin. The guard for typing context lives
 * in the hook (this function only decides which intent a chord means).
 */

export type PlayerShortcut =
  | "toggle-play"
  | "next"
  | "prev"
  | "seek-forward"
  | "seek-back"
  | "volume-up"
  | "volume-down"
  | "cycle-repeat"
  | "restart";

export interface ShortcutKeyEvent {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

/** Map a key chord to a transport intent, or null when it isn't a player shortcut. */
export function resolvePlayerShortcut(e: ShortcutKeyEvent): PlayerShortcut | null {
  if (e.altKey) return null;
  const k = e.key.toLowerCase();
  const mod = !!(e.metaKey || e.ctrlKey);

  if (mod) {
    // Only Cmd/Ctrl+P and +R are player shortcuts; leave Cmd+1/2/3 to nav, etc.
    if (k === "p") return "toggle-play";
    if (k === "r") return "cycle-repeat";
    return null;
  }

  if (k === " ") return "toggle-play";

  if (e.shiftKey) {
    if (k === "arrowleft" || k === "a") return "seek-back";
    if (k === "arrowright" || k === "d") return "seek-forward";
    return null;
  }

  if (k === "arrowleft" || k === "a") return "prev";
  if (k === "arrowright" || k === "d") return "next";
  if (k === "arrowup") return "volume-up";
  if (k === "arrowdown") return "volume-down";
  if (k === "r") return "restart";
  return null;
}
