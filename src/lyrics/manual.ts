/**
 * Manual lyrics entry: turn user-pasted text into a persistable record. The format
 * is auto-detected (LRC / Enhanced LRC / yrc / qrc / TTML), so pasting any timed
 * format — including an AMLL `.ttml` file — gets word-level karaoke; untimed text
 * is stored as plain. Timed text is kept verbatim so formatting survives. Always
 * `source: "manual"` so it wins on merge and auto-fetch never overwrites it. Pure.
 */

import { detectLyricsFormat } from "./parse";
import type { LyricsRecord } from "./provider";

export function lyricsRecordFromManualText(text: string): LyricsRecord {
  const trimmed = text.trim();
  const format = detectLyricsFormat(trimmed);
  if (format === "plain") {
    return { source: "manual", instrumental: false, status: "found", plain: trimmed };
  }
  return {
    source: "manual",
    instrumental: false,
    status: "found",
    synced: text, // verbatim — preserve the pasted formatting
    format,
  };
}
