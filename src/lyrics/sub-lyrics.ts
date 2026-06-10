/**
 * Attach translation / romanization sub-lines to the main lyric lines. Sources
 * (NetEase `tlyric`/`romalrc`, etc.) ship these as SEPARATE line-level LRC tracks,
 * so we parse each and align to the main lines by nearest timestamp (within a small
 * tolerance — the stamps usually match exactly, but covers/edits drift). Pure;
 * returns a new array and leaves the main lines (incl. `words`) untouched. TTML
 * (Phase 5) carries translation/roman inline and bypasses this.
 */

import type { LyricLine } from "./model";
import { parseLrc } from "./parse-lrc";

const TOLERANCE_MS = 400;

export function attachSubLyrics(
  main: LyricLine[],
  translation?: string,
  roman?: string,
): LyricLine[] {
  const tl = translation ? parseLrc(translation) : [];
  const rm = roman ? parseLrc(roman) : [];
  if (tl.length === 0 && rm.length === 0) return main;
  return main.map((line) => {
    const t = nearest(tl, line.timeMs);
    const r = nearest(rm, line.timeMs);
    if (!t && !r) return line;
    return { ...line, ...(t ? { translation: t } : {}), ...(r ? { roman: r } : {}) };
  });
}

/** Text of the sub-line whose timestamp is closest to `ms`, within tolerance. */
function nearest(lines: { timeMs: number; text: string }[], ms: number): string | undefined {
  let best: string | undefined;
  let bestDelta = TOLERANCE_MS;
  for (const l of lines) {
    const d = Math.abs(l.timeMs - ms);
    if (d <= bestDelta && l.text) {
      best = l.text;
      bestDelta = d;
    }
  }
  return best;
}
