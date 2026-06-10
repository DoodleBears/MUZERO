/**
 * Enhanced LRC / LRC A2 parser: a line stamp `[mm:ss.xx]` followed by inline
 * per-word stamps `<mm:ss.xx>word`. Each word starts at its `<…>` time; its
 * duration runs to the next word (or, for the last word of a line, to the next
 * line's start). Normalizes into the unified `LyricLine[]` model with `words`.
 * No IO — exhaustively unit-tested.
 */

import type { LyricLine, WordTiming } from "../model";

const LINE_STAMP = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/;
const LEADING_STAMPS = /^\s*(?:\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\])+/;
const WORD_STAMP = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g;
/** Fallback fill for the very last word (no next line to bound it). */
const LAST_WORD_MS = 800;

function stampToMs(min: string, sec: string, frac?: string): number {
  const f = frac ? Math.round(Number.parseFloat(`0.${frac}`) * 1000) : 0;
  return Number(min) * 60_000 + Number(sec) * 1000 + f;
}

interface RawLine {
  timeMs: number;
  words: { timeMs: number; text: string }[];
}

export function parseEnhancedLrc(raw: string): LyricLine[] {
  const raws: RawLine[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const head = rawLine.match(LINE_STAMP);
    if (!head) continue;
    const lineStart = stampToMs(head[1], head[2], head[3]);
    const body = rawLine.replace(LEADING_STAMPS, "");

    const words: { timeMs: number; text: string }[] = [];
    WORD_STAMP.lastIndex = 0;
    let m = WORD_STAMP.exec(body);
    if (m && m.index > 0) {
      const lead = body.slice(0, m.index); // text before the first stamp (rare)
      if (lead.trim()) words.push({ timeMs: lineStart, text: lead });
    }
    while (m) {
      const textStart = m.index + m[0].length;
      const next = WORD_STAMP.exec(body);
      words.push({
        timeMs: stampToMs(m[1], m[2], m[3]),
        text: body.slice(textStart, next ? next.index : undefined),
      });
      m = next;
    }
    if (words.length === 0) {
      const text = body.trim();
      if (text) words.push({ timeMs: lineStart, text });
    }
    raws.push({ timeMs: lineStart, words });
  }

  const lines: LyricLine[] = [];
  for (let i = 0; i < raws.length; i++) {
    const { timeMs, words } = raws[i];
    if (words.length === 0) {
      lines.push({ timeMs, text: "" });
      continue;
    }
    const nextLineStart = i + 1 < raws.length ? raws[i + 1].timeMs : undefined;
    const out: WordTiming[] = words.map((w, j) => {
      const end =
        j + 1 < words.length ? words[j + 1].timeMs : (nextLineStart ?? w.timeMs + LAST_WORD_MS);
      return { timeMs: w.timeMs, durMs: Math.max(0, end - w.timeMs), text: w.text };
    });
    const last = out[out.length - 1];
    lines.push({
      timeMs,
      endMs: last.timeMs + last.durMs,
      text: out
        .map((w) => w.text)
        .join("")
        .trim(),
      words: out,
    });
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}
