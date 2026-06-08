import type { SetDisplayMode, Track } from "@/db/types";

/** What the "stage" should render for the current track. */
export type StageContent = "video" | "cover" | "title";

/**
 * Resolve what to show on the now-playing stage, honoring the set's display mode
 * with the fallback the product wants: video-first → cover → title.
 *  - "video" mode: play the video when available, else a cover image if present,
 *    else the title card.
 *  - "cover" mode: cover image if present, else title.
 */
export function resolveStageContent(opts: {
  track?: Track;
  displayMode: SetDisplayMode;
  hasCover: boolean;
}): StageContent {
  const { track, displayMode, hasCover } = opts;
  if (!track) return "title";
  if (displayMode === "cover") return hasCover ? "cover" : "title";
  // displayMode === "video"
  if (track.kind === "video" && track.status === "ready") return "video";
  if (hasCover) return "cover";
  return "title";
}

/**
 * A short subtitle line for a track. Returns data only (caption → note → title);
 * the empty-track fallback copy is localized at the call site.
 */
export function trackSubtitle(track: Track | undefined): string {
  if (!track) return "";
  if (track.brief?.caption) return track.brief.caption;
  const metadata = track.mediaMetadata;
  const artist = metadata?.artists?.join(", ");
  const album = metadata?.album;
  if (artist && album) return `${artist} - ${album}`;
  if (artist) return artist;
  if (album) return album;
  return track.note ?? track.title;
}
