/**
 * Display-only keyboard hints for the transport controls' tooltips. Pure (no
 * React/DOM) so the mapping is unit-tested and the control components stay thin.
 * Mirrors the default transport bindings in the shortcut registry
 * (`src/shortcuts/registry.ts`), showing ONE representative key per action.
 * Transport sits on Q/E (the arrows/WASD drive library navigation instead);
 * Shift+Q/E scrubs. NOTE: still hard-coded to defaults — Phase 2b swaps these for
 * the user's live bindings via the registry.
 */
export type HintAction = "play" | "prev" | "next" | "repeat" | "shuffle" | "volume";

export function playerShortcutHint(action: HintAction, mac: boolean): string[] {
  switch (action) {
    case "play":
      return ["Space"];
    case "prev":
      return ["Q"];
    case "next":
      return ["E"];
    case "repeat":
      return ["R"];
    case "shuffle":
      return [mac ? "Option" : "Alt", "R"];
    case "volume":
      // Up/down adjust by ±5%; both arrows shown side by side, not a chord.
      return ["↑", "↓"];
  }
}

/**
 * Map a pointer's Y to a 0–1 volume for a vertical slider whose track spans
 * `[top, top+height]` in client coordinates. Inverted (top of the track = loud),
 * clamped to [0,1], and divide-safe for a zero-height track.
 */
export function volumeFromPointerY(clientY: number, top: number, height: number): number {
  if (!(height > 0)) return 0;
  const ratio = (clientY - top) / height;
  const value = 1 - ratio;
  return Math.min(1, Math.max(0, value));
}
