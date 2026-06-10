/**
 * The single entry point for turning raw lyric text into the unified `LyricLine[]`
 * model. `parseLyrics` dispatches on the stored `format` (or auto-detects it),
 * keeping every format's quirks inside its own pure parser — the renderer only
 * ever sees `LyricLine[]` and never branches on format.
 *
 * Phase 1 shipped detection + the line-level LRC path. Phase 2 plugs in the
 * `elrc` / `yrc` / `qrc` word-level parsers; Phase 5 adds `ttml`. The renderer
 * only ever sees `LyricLine[]`. No IO — exhaustively unit-tested.
 */

import { parseEnhancedLrc } from "./formats/enhanced-lrc";
import { parseQrc } from "./formats/qrc";
import { parseTtml } from "./formats/ttml";
import { parseYrc } from "./formats/yrc";
import type { LyricFormat, LyricLine } from "./model";
import { parseLrc } from "./parse-lrc";

const TTML_HINT = /<tt[\s>]|<\/p>|xmlns/i;
const YRC_WORD = /\(\d+,\d+,\d+\)/; // (start,dur,0) — three ints
const QRC_WORD = /\(\d+,\d+\)/; // text(start,dur) — two ints
const MS_HEADER = /\[\d+,\d+\]/; // [start,dur] line header (yrc + qrc)
const ELRC_WORD = /<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/; // <mm:ss.xx>
const LRC_STAMP = /\[\d{1,2}:\d{2}/; // [mm:ss…

/**
 * Best-effort format detection for raw text whose format wasn't recorded (older
 * rows, ambiguous providers). Pure; exhaustively unit-tested. Order matters:
 * TTML (XML) → yrc (3-int word) → qrc (2-int word) → elrc (`<…>`) → lrc → plain.
 */
export function detectLyricsFormat(raw: string): LyricFormat {
  const head = raw.trimStart();
  if (!head) return "plain";
  if (head.startsWith("<") && TTML_HINT.test(raw)) return "ttml";
  const hasMsHeader = MS_HEADER.test(raw);
  if (hasMsHeader && YRC_WORD.test(raw)) return "yrc";
  if (hasMsHeader && QRC_WORD.test(raw)) return "qrc";
  if (ELRC_WORD.test(raw)) return "elrc";
  if (LRC_STAMP.test(raw)) return "lrc";
  return "plain";
}

/** Parse raw lyric text into the unified model, dispatching on `format`. */
export function parseLyrics(raw: string, format?: LyricFormat): LyricLine[] {
  if (!raw) return [];
  switch (format ?? detectLyricsFormat(raw)) {
    case "plain":
      return [];
    case "elrc":
      return parseEnhancedLrc(raw);
    case "yrc":
      return parseYrc(raw);
    case "qrc":
      return parseQrc(raw);
    case "ttml":
      return parseTtml(raw);
    default:
      return parseLrc(raw).map((line) => ({ timeMs: line.timeMs, text: line.text }));
  }
}
