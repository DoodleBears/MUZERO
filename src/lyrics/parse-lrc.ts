/**
 * Pure LRC parser: turns raw `[mm:ss.cs]` lyric text into time-ordered lines.
 *
 * Handles: 1–3 fractional digits, multiple timestamps per line (expanded into
 * one line each), the `[offset:±ms]` tag (added to every timestamp, clamped at
 * 0), interlude lines (timestamp + empty text), and skips metadata tags
 * (`[ar:]`/`[ti:]`/…) and malformed/non-timestamped lines. Output is sorted
 * ascending by time. No IO — exhaustively unit-tested.
 */

export interface LyricsLine {
  /** Start time of the line, milliseconds from the track start. */
  timeMs: number;
  text: string;
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_TAG = /\[offset:\s*([+-]?\d+)\s*\]/i;
const WORD_TAG = /<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g;

function fractionToMs(frac: string | undefined): number {
  if (!frac) return 0;
  return Math.round(Number.parseFloat(`0.${frac}`) * 1000);
}

/**
 * Strip Enhanced-LRC / LRC-A2 per-word stamps (`<mm:ss.xx>`) from a line's text so
 * the line-level parser renders the words, never the raw stamps. (Word-level
 * timing is parsed by the dedicated `elrc` parser in Phase 2.) Collapses the
 * doubled space a stamp leaves behind when it sat between two spaces.
 */
export function stripInlineWordTags(text: string): string {
  return text.replace(WORD_TAG, "").replace(/ {2,}/g, " ");
}

export function parseLrc(lrc: string): LyricsLine[] {
  if (!lrc) return [];

  const offsetMatch = lrc.match(OFFSET_TAG);
  const offsetMs = offsetMatch ? Number.parseInt(offsetMatch[1], 10) : 0;

  const lines: LyricsLine[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    TIME_TAG.lastIndex = 0;
    const stamps: number[] = [];
    let textStart = 0;
    let match: RegExpExecArray | null = TIME_TAG.exec(rawLine);
    while (match !== null) {
      const min = Number.parseInt(match[1], 10);
      const sec = Number.parseInt(match[2], 10);
      stamps.push(min * 60_000 + sec * 1000 + fractionToMs(match[3]));
      textStart = match.index + match[0].length;
      match = TIME_TAG.exec(rawLine);
    }
    if (stamps.length === 0) continue; // metadata / blank / garbage line
    const text = stripInlineWordTags(rawLine.slice(textStart)).trim();
    for (const stamp of stamps) {
      lines.push({ timeMs: Math.max(0, stamp + offsetMs), text });
    }
  }

  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}

/**
 * Index of the line that should be active at `positionMs` — the last line whose
 * timestamp is ≤ the position. Returns -1 before the first line (or when empty).
 * Binary search; `lines` must be time-sorted (parseLrc guarantees it).
 */
export function activeLineIndex(lines: LyricsLine[], positionMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
