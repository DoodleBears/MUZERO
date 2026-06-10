/**
 * The single arbiter of "what lyrics to show for this track" — mirrors
 * `resolveStageContent` (video→cover→title). Source priority:
 *   stored synced → stored plain → generated `brief.lyrics` → instrumental → none.
 * The UI renders the returned discriminated union and never branches on source.
 * Pure — exhaustively unit-tested.
 */

import type { Track } from "@/db/types";
import { type LyricsLine, parseLrc } from "./parse-lrc";
import type { LyricsRecord, LyricsSource } from "./provider";

export type ResolvedLyrics =
  | { mode: "synced"; lines: LyricsLine[]; source: LyricsSource }
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
      const lines = parseLrc(record.synced);
      if (lines.length > 0) return { mode: "synced", lines, source: record.source };
    }
    if (record.plain?.trim()) return { mode: "plain", text: record.plain, source: record.source };
  }
  const brief = track?.brief?.lyrics?.trim();
  if (brief) return { mode: "plain", text: brief, source: "brief" };
  return { mode: "none" };
}
