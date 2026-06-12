import type { LyricLine } from "./model";

const FALLBACK_LINE_DURATION_MS = 3000;
const MIN_LINE_DURATION_MS = 40;

export interface LyricRenderWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface LyricRenderLine {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  words?: LyricRenderWord[];
  translation?: string;
  roman?: string;
}

function lineEndMs(line: LyricLine, next: LyricLine | undefined): number {
  const candidate = line.endMs ?? next?.timeMs ?? line.timeMs + FALLBACK_LINE_DURATION_MS;
  return Math.max(line.timeMs + MIN_LINE_DURATION_MS, candidate);
}

function wordEndMs(lineEnd: number, word: NonNullable<LyricLine["words"]>[number]): number {
  return Math.max(word.timeMs + MIN_LINE_DURATION_MS, Math.min(lineEnd, word.timeMs + word.durMs));
}

export function toLyricRenderLines(lines: LyricLine[]): LyricRenderLine[] {
  return lines.map((line, index) => {
    const endMs = lineEndMs(line, lines[index + 1]);
    return {
      id: `${line.timeMs}:${index}:${line.text}`,
      index,
      startMs: line.timeMs,
      endMs,
      text: line.text,
      words: line.words?.map((word) => ({
        text: word.text,
        startMs: word.timeMs,
        endMs: wordEndMs(endMs, word),
      })),
      translation: line.translation,
      roman: line.roman,
    };
  });
}
