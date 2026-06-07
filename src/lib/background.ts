import type { BackgroundMode } from "@/db/types";

/**
 * What the Now-Playing ambient background should pull from. Pure decision so the
 * priority rules are unit-tested without the DB. `mode` is the *priority* between
 * the track's two own assets, then the global gallery is an optional last resort:
 *  - "cover"     → the track's cover first, then its bound slideshow.
 *  - "slideshow" → the track's bound slideshow first, then its cover.
 * When the track has neither, fall back to the shared global gallery only if
 * `galleryFallback` is on; otherwise nothing.
 */
export type BackgroundSource = "track-slideshow" | "gallery-slideshow" | "cover" | "none";

export function resolveBackgroundSource(opts: {
  mode: BackgroundMode | undefined;
  /** Allow the shared global gallery when the track has no own slideshow/cover. Default true. */
  galleryFallback?: boolean;
  hasCover: boolean;
  trackBackgroundCount: number;
  galleryCount: number;
}): BackgroundSource {
  const { mode, galleryFallback = true, hasCover, trackBackgroundCount, galleryCount } = opts;
  const hasTrackSlideshow = trackBackgroundCount > 0;

  // The track's own assets, ordered by the chosen priority.
  if (mode === "slideshow") {
    if (hasTrackSlideshow) return "track-slideshow";
    if (hasCover) return "cover";
  } else {
    // "cover" priority (default)
    if (hasCover) return "cover";
    if (hasTrackSlideshow) return "track-slideshow";
  }

  // The track has neither — optionally borrow the shared global gallery.
  if (galleryFallback && galleryCount > 0) return "gallery-slideshow";
  return "none";
}
