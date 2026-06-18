import type { BackgroundMode, TrackKind, TrackStatus } from "@/db/types";
import {
  type BackgroundMediaSource,
  type BackgroundMediaType,
  resolveBackgroundSource,
  resolvePixiBackgroundMedia,
} from "./background";
import type { FrameLike } from "./background-composition";

/**
 * Resolve a track into the Background Frame *spec* — the frozen "what to show"
 * the controller transitions between (PRD Phase 1/2; also consolidation R3's
 * source extraction). Pure: it decides source + renderer kind from the track and
 * settings; the controller hook fills in the resolved media URL + palette and
 * runs it through the ready-gate. Composes the existing tested `background.ts`
 * source rules so the priority logic lives in exactly one place.
 */

export type BackgroundRendererKind = "blur" | "pixi" | "plain";

export interface BackgroundFrame extends FrameLike {
  trackId: string;
  source: BackgroundMediaSource;
  mediaType: BackgroundMediaType;
  rendererKind: BackgroundRendererKind;
}

/** The renderer values that go through the Pixi WebGL background. */
const PIXI_RENDERERS = new Set(["pixel", "ascii", "cross-hatch", "crt", "dot", "noise"]);

export function rendererKindFor(renderer: string | undefined): BackgroundRendererKind {
  if (renderer === "blur") return "blur";
  if (renderer && PIXI_RENDERERS.has(renderer)) return "pixi";
  return "plain";
}

export function resolveBackgroundFrameSpec(opts: {
  trackId: string;
  mode: BackgroundMode | undefined;
  renderer: string | undefined;
  galleryFallback?: boolean;
  hasCover: boolean;
  trackBackgroundCount: number;
  galleryCount: number;
  trackKind?: TrackKind;
  trackStatus?: TrackStatus;
  hasTrackVideo: boolean;
}): BackgroundFrame {
  const imageSource = resolveBackgroundSource({
    mode: opts.mode,
    galleryFallback: opts.galleryFallback,
    hasCover: opts.hasCover,
    trackBackgroundCount: opts.trackBackgroundCount,
    galleryCount: opts.galleryCount,
  });
  const rendererKind = rendererKindFor(opts.renderer);
  // Pixi renderers can texture the MV itself. `blur` stays on the image frame
  // controller for covers, but switches to Pixi when the source is a ready MV so
  // the blur is applied to the video texture instead of the poster/cover.
  if (rendererKind === "blur") {
    const pixiMedia = resolvePixiBackgroundMedia({
      imageSource,
      mode: opts.mode,
      trackKind: opts.trackKind,
      trackStatus: opts.trackStatus,
      hasTrackMedia: opts.hasTrackVideo,
    });
    if (pixiMedia.source === "track-video") {
      return {
        trackId: opts.trackId,
        source: pixiMedia.source,
        mediaType: pixiMedia.mediaType,
        rendererKind: "pixi",
      };
    }
  }
  if (rendererKind === "pixi") {
    const pixiMedia = resolvePixiBackgroundMedia({
      imageSource,
      mode: opts.mode,
      trackKind: opts.trackKind,
      trackStatus: opts.trackStatus,
      hasTrackMedia: opts.hasTrackVideo,
    });
    return {
      trackId: opts.trackId,
      source: pixiMedia.source,
      mediaType: pixiMedia.mediaType,
      rendererKind,
    };
  }
  return { trackId: opts.trackId, source: imageSource, mediaType: "image", rendererKind };
}
