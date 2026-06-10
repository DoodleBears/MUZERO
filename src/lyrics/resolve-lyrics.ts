/**
 * The single arbiter of "what lyrics to show for this track" — mirrors
 * `resolveStageContent` (video→cover→title). Source priority:
 *   stored synced → stored plain → generated `brief.lyrics` → instrumental → none.
 * The UI renders the returned discriminated union and never branches on source.
 * Pure — exhaustively unit-tested.
 */

import type { Track } from "@/db/types";
import type { LyricLine } from "./model";
import { parseLyrics } from "./parse";
import type { LyricsRecord, LyricsSource } from "./provider";
import { attachSubLyrics } from "./sub-lyrics";

export type ResolvedLyrics =
  | { mode: "synced"; lines: LyricLine[]; source: LyricsSource }
  | { mode: "plain"; text: string; source: LyricsSource | "brief" }
  | { mode: "instrumental" }
  | { mode: "none" };

export function resolveTrackLyrics(
  track: Track | undefined,
  record: LyricsRecord | undefined,
): ResolvedLyrics {
  if (record) {
    if (record.instrumental || record.status === "instrumental") return { mode: "instrumental" };
    if (record.synced) {
      const parsed = parseLyrics(record.synced, record.format);
      if (parsed.length > 0) {
        const lines = attachSubLyrics(parsed, record.translation, record.romanization);
        return { mode: "synced", lines, source: record.source };
      }
    }
    if (record.plain?.trim()) return { mode: "plain", text: record.plain, source: record.source };
  }
  const brief = track?.brief?.lyrics?.trim();
  if (brief) return { mode: "plain", text: brief, source: "brief" };
  return { mode: "none" };
}
