import { modifierSymbol } from "@/lib/shortcuts";

/**
 * Display-only keyboard hints for the transport controls' tooltips. Pure (no
 * React/DOM) so the mapping is unit-tested and the control components stay thin.
 * Mirrors the bindings in {@link resolvePlayerShortcut} but shows ONE
 * representative key per action (alternatives like `A`/`D` are omitted to keep
 * the `Kbd` caps readable — multiple caps read as a chord).
 */
export type HintAction = "play" | "prev" | "next" | "repeat" | "volume";

export function playerShortcutHint(action: HintAction, mac: boolean): string[] {
  switch (action) {
    case "play":
      return ["Space"];
    case "prev":
      return ["←"];
    case "next":
      return ["→"];
    case "repeat":
      return [modifierSymbol(mac), "R"];
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
