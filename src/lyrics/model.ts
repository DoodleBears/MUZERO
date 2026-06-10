/**
 * The unified lyrics model. Every format parser (lrc / elrc / yrc / qrc / ttml)
 * normalizes into `LyricLine[]`, and the renderer reads ONLY this shape — it never
 * branches on the source format (same discipline as the musicgen / lyrics
 * registries). Line-level sources leave `words` undefined and fall back to
 * whole-line highlight; word-timed sources fill `words` for per-syllable karaoke.
 *
 * Stored as raw text + a `format` tag (DB `TrackLyrics`); parsing happens at
 * render time (pure), so a parser upgrade is a re-parse, never a migration.
 * No IO — exhaustively unit-tested per parser.
 */

/** Which parser to run over the raw lyric text. */
export type LyricFormat = "lrc" | "elrc" | "yrc" | "qrc" | "ttml" | "plain";

/** A timed word / syllable inside a line (karaoke fill). */
export interface WordTiming {
  /** Word start, milliseconds from track start. */
  timeMs: number;
  /** Word duration in ms (fill animates across this window). */
  durMs: number;
  /**
   * Word/syllable text — KEEP its own trailing space so re-joining words never
   * drops the gap between them (avoids the "youdon't" bug). The renderer
   * concatenates `words[].text` to reconstruct the visible line.
   */
  text: string;
}

/** One lyric line in the unified model. */
export interface LyricLine {
  /** Line start, milliseconds from track start. */
  timeMs: number;
  /** Line end (last word's end, or next line's start). Optional. */
  endMs?: number;
  /** Whole-line plain text (always present; used when `words` is absent). */
  text: string;
  /** Per-word timings for karaoke fill; absent for line-level sources. */
  words?: WordTiming[];
  /** Translation sub-line (TTML `x-translation` / bilingual LRC). */
  translation?: string;
  /** Romanization sub-line (TTML `x-roman`). */
  roman?: string;
  /** Singer role for duets (TTML `agent`): main / secondary / background. */
  agent?: "v1" | "v2" | "bg";
}
