import type { SetDisplayMode, Track } from "@/db/types";

/** What the "stage" should render for the current track. */
export type StageContent = "video" | "cover" | "title";

/**
 * Resolve what to show on the now-playing stage, honoring the set's display mode
 * with the fallback the product wants: video-first → cover → title.
 *  - "video" mode: play the video (unless audio-only or it's an audio track),
 *    else a cover image if present, else the title card.
 *  - "cover" mode: cover image if present, else title.
 *  - "title" mode: always the title card (+ visualizer).
 * `audioOnly` forces "don't show video" (play a video's audio without watching).
 */
export function resolveStageContent(opts: {
  track?: Track;
  displayMode: SetDisplayMode;
  audioOnly: boolean;
  hasCover: boolean;
}): StageContent {
  const { track, displayMode, audioOnly, hasCover } = opts;
  if (!track) return "title";
  if (displayMode === "title") return "title";
  if (displayMode === "cover") return hasCover ? "cover" : "title";
  // displayMode === "video"
  if (track.kind === "video" && track.status === "ready" && !audioOnly) return "video";
  if (hasCover) return "cover";
  return "title";
}

/**
 * A short subtitle line for a track. Returns data only (caption → note → title);
 * the empty-track fallback copy is localized at the call site.
 */
export function trackSubtitle(track: Track | undefined): string {
  if (!track) return "";
  return track.brief?.caption ?? track.note ?? track.title;
}
