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

function fractionToMs(frac: string | undefined): number {
  if (!frac) return 0;
  return Math.round(Number.parseFloat(`0.${frac}`) * 1000);
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
    const text = rawLine.slice(textStart).trim();
    for (const stamp of stamps) {
      lines.push({ timeMs: Math.max(0, stamp + offsetMs), text });
    }
  }

  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}
