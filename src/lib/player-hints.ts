/**
 * Which transport tooltip a hint is for. The hint chips themselves now come from
 * the configurable registry via {@link useShortcutHint} (so they reflect the
 * user's rebinds), not a hard-coded table.
 */
export type HintAction = "play" | "prev" | "next" | "repeat" | "shuffle" | "volume";

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
