/**
 * Index of the word that should be "current" at `positionMs` — the last word whose
 * start is ≤ the position. Returns -1 before the first word (or when empty). Binary
 * search; `words` must be time-sorted (the format parsers guarantee it). Mirrors
 * `activeLineIndex` one level down, for per-syllable karaoke fill. Pure.
 */

import type { WordTiming } from "./model";

export function activeWordIndex(words: WordTiming[], positionMs: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].timeMs <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
