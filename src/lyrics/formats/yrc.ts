/**
 * NetEase YRC parser: a line header `[startMs,durationMs]` followed by word stamps
 * `(startMs,durationMs,0)word`. Word start times are ABSOLUTE (ms from track start)
 * and durations are explicit, so each maps straight to a `WordTiming`. Credit lines
 * (songwriter/composer JSON, with or without a header) are dropped. Normalizes into
 * the unified `LyricLine[]` model. No IO — exhaustively unit-tested.
 */

import type { LyricLine, WordTiming } from "../model";

const YRC_LINE = /^\s*\[(\d+),(\d+)\]/;
// (start,dur,0) then the word text up to the next "(".
const YRC_WORD = /\((\d+),(\d+)(?:,\d+)?\)([^(]*)/g;

export function parseYrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const head = rawLine.match(YRC_LINE);
    if (!head) continue;
    const lineStart = Number(head[1]);
    const lineDur = Number(head[2]);
    const body = rawLine.slice(head[0].length);
    if (body.trimStart().startsWith("{")) continue; // credit-JSON metadata line

    const words: WordTiming[] = [];
    YRC_WORD.lastIndex = 0;
    let m = YRC_WORD.exec(body);
    while (m) {
      words.push({ timeMs: Number(m[1]), durMs: Number(m[2]), text: m[3] });
      m = YRC_WORD.exec(body);
    }

    if (words.length === 0) {
      const text = body.trim();
      if (text) lines.push({ timeMs: lineStart, endMs: lineStart + lineDur, text });
      continue;
    }
    lines.push({
      timeMs: lineStart,
      endMs: lineStart + lineDur,
      text: words
        .map((w) => w.text)
        .join("")
        .trim(),
      words,
    });
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}
