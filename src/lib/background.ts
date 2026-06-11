import type { BackgroundMode, TrackKind, TrackStatus } from "@/db/types";

/**
 * What the Now-Playing ambient background should pull from. Pure decision so the
 * priority rules are unit-tested without the DB. `mode` is the *priority* between
 * the track's two own image assets, then the global gallery is an optional last resort:
 *  - "cover"     → the track's cover first, then its bound slideshow.
 *  - "slideshow" → the track's bound slideshow first, then its cover.
 *  - "none"      → no ambient background at all (cover/slideshow/gallery all off).
 * When the track has neither, fall back to the shared global gallery only if
 * `galleryFallback` is on; otherwise nothing.
 */
export type BackgroundSource = "track-slideshow" | "gallery-slideshow" | "cover" | "none";
export type BackgroundMediaSource = BackgroundSource | "track-video";
export type BackgroundMediaType = "image" | "video";
export type BackgroundRenderTarget = {
  mediaType: BackgroundMediaType;
  src: string;
};

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

  // The user explicitly wants no ambient background — skip cover/slideshow/gallery.
  if (mode === "none") return "none";

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

/**
 * Pixi renderers can texture from the current uploaded MV itself. Keep that
 * choice separate from the image priority above so blur/plain image renderers
 * continue to use cover/slideshow sources only.
 */
export function resolvePixiBackgroundMedia(opts: {
  imageSource: BackgroundSource;
  /** When the user explicitly picked "none", suppress the MV-as-backdrop too. */
  mode?: BackgroundMode;
  trackKind?: TrackKind;
  trackStatus?: TrackStatus;
  hasTrackMedia: boolean;
}): { source: BackgroundMediaSource; mediaType: BackgroundMediaType } {
  if (opts.mode === "none") return { source: "none", mediaType: "image" };
  if (opts.trackKind === "video" && opts.trackStatus === "ready" && opts.hasTrackMedia) {
    return { source: "track-video", mediaType: "video" };
  }
  return { source: opts.imageSource, mediaType: "image" };
}

/**
 * Keep the currently painted background while the next known source is still
 * resolving its object URL. Without this, song changes briefly render the base
 * app background before the next cover/slideshow frame can crossfade in.
 */
export function settleBackgroundTarget<T extends BackgroundRenderTarget>(
  current: T | null,
  next: T | null,
  hasPendingSource: boolean,
): T | null {
  if (next) return next;
  if (hasPendingSource) return current;
  return null;
}
