/**
 * Pure transport-bar helpers (no React, no store) so the player-dock UI stays a
 * thin presentational shell. Sibling to `queue.ts` (pure queue math).
 */

import type { RepeatMode } from "./queue";

const REPEAT_CYCLE: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };

/** The next repeat mode when the repeat button is pressed: off → all → one → off. */
export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  return REPEAT_CYCLE[mode];
}

/** Map a playback position to a 0–100 progress percentage, clamped and divide-safe. */
export function progressPercent(positionSec: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  const pct = (positionSec / durationSec) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * The single status line shown under the scrubber. Priority: a DJ/upload error
 * outranks any in-flight work, then an active upload, then DJ generation. Returns
 * a `kind` (localized at the call site) rather than copy, per the i18n rule.
 */
export type PlayerStatus =
  | { kind: "error"; message: string }
  | { kind: "uploading" }
  | { kind: "generating" }
  | null;

export function resolveStatusLine(s: {
  isUploading: boolean;
  isGenerating: boolean;
  djError: string | null;
}): PlayerStatus {
  if (s.djError) return { kind: "error", message: s.djError };
  if (s.isUploading) return { kind: "uploading" };
  if (s.isGenerating) return { kind: "generating" };
  return null;
}
