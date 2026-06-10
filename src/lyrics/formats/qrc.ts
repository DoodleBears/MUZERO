/**
 * QQ Music QRC parser: a line header `[startMs,durationMs]` followed by words in
 * TEXT-then-TIME order — `word(startMs,durationMs)` (note the reverse of yrc's
 * time-then-text). Word start times are ABSOLUTE and durations explicit. Assumes
 * already-decrypted plaintext qrc (QQ ships it DES-encrypted; decryption is out of
 * scope). Normalizes into the unified `LyricLine[]` model. No IO — unit-tested.
 */

import type { LyricLine, WordTiming } from "../model";

const QRC_LINE = /^\s*\[(\d+),(\d+)\]/;
// word text (no parens) then its (start,dur).
const QRC_WORD = /([^()]*?)\((\d+),(\d+)\)/g;

export function parseQrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const head = rawLine.match(QRC_LINE);
    if (!head) continue;
    const lineStart = Number(head[1]);
    const lineDur = Number(head[2]);
    const body = rawLine.slice(head[0].length);
    if (body.trimStart().startsWith("{")) continue; // metadata line

    const words: WordTiming[] = [];
    QRC_WORD.lastIndex = 0;
    let m = QRC_WORD.exec(body);
    while (m) {
      words.push({ timeMs: Number(m[2]), durMs: Number(m[3]), text: m[1] });
      m = QRC_WORD.exec(body);
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
