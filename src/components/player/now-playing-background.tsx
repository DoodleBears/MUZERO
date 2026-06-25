import { useLiveQuery } from "dexie-react-hooks";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getTrackLyrics, listGalleryImageRows, listTrackBackgroundRows } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { useLoadedImageUrl } from "@/hooks/use-image-load";
import { useLocalCoverResource } from "@/hooks/use-local-cover";
import { useMediaBlobUrl, useTrackCoverResource, useTrackMediaUrl } from "@/hooks/use-media";
import {
  type BackgroundRenderTarget,
  resolveBackgroundSource,
  resolvePixiBackgroundMedia,
  settleBackgroundTarget,
  trackHasBackgroundVideoMedia,
} from "@/lib/background";
import { resolveBackgroundFrameSpec } from "@/lib/background-frame";
import { FLOW_DEFAULTS, VISUALIZER_BLEND_DEFAULT } from "@/lib/flow-config";
import { createDiagnosticLogger } from "@/lib/logger";
import { nextSlideIndex } from "@/lib/slideshow";
import { trackHasCover, trackIsPlayableVideo } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import { resolveVisualizerBackgroundCompositeOptions } from "@/lib/visualizer-effect-settings";
import { resolveTrackLyrics } from "@/lyrics/resolve-lyrics";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";
import { VisualizerHost } from "@/visualizer/host";
import { resolveVisualizerStyle } from "@/visualizer/registry";
import { BackgroundFrameStack } from "./background/background-frame-stack";
import { TransitionBackground } from "./background/transition-background";
import { useBackgroundController } from "./background/use-background-controller";
import { CanvasBlurBackground } from "./canvas-blur-background";
import { getCoverWindow, subscribeWindow } from "./cover-window-store";
import { type PixiBackgroundEffect, PixiPixelBackground } from "./pixi-pixel-background";

const bgCoverLog = createDiagnosticLogger("background.cover");

/**
 * Resting opacity of the cover-background group, applied ONCE to the whole group
 * (the controller layer stack + the drag transition layer) with the layers at
 * full opacity inside — a crossfade then stays fully opaque end-to-end, so two
 * covers overlapping never composite brighter than one (QA: "image brightens
 * then dims back" during a switch). At 1.0 the group itself does no dimming; the
 * only backdrop darkening is the separate 25% `imageMask` above it.
 */
const COVER_GROUP_OPACITY = 1;
const ENABLE_PIXI_BACKGROUND_FOR_BISECT = true;
const DISABLE_PIXI_TEXTURE_SOURCE_FOR_BISECT = false;

export function shouldRunBackgroundSlideshow({
  documentHidden,
  slideCount,
}: {
  documentHidden: boolean;
  slideCount: number;
}): boolean {
  return !documentHidden && slideCount > 1;
}

/**
 * Now Playing ambient backdrop.
 *
 * Desktop Tauri on macOS uses WKWebView, whose compositor is much more fragile
 * than Chrome with full-screen filtered images. Blur uses canvas downsampling
 * instead of CSS filter; pixel mode loads its renderer only when selected.
 */
export function NowPlayingBackground({
  active = true,
  className,
  hideVisualizer = false,
  immersive = false,
}: {
  active?: boolean;
  className?: string;
  hideVisualizer?: boolean;
  immersive?: boolean;
}) {
  return (
    <div
      // `isolate` scopes the flow layer's mix-blend-mode to this background group
      // (image/video + flow + visualizer) so it never blends with the app behind.
      className={cn(
        "pointer-events-none absolute inset-0 isolate overflow-hidden bg-background",
        className,
      )}
      aria-hidden="true"
    >
      {active ? (
        <NowPlayingBackgroundContent hideVisualizer={hideVisualizer} immersive={immersive} />
      ) : null}
    </div>
  );
}

function NowPlayingBackgroundContent({
  hideVisualizer,
  immersive,
}: {
  hideVisualizer: boolean;
  immersive: boolean;
}) {
  const settings = useSettings();
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const displayMode = usePlayerStore((s) => s.displayMode);
  // Single source of truth: the ambient background reads the SAME live index as the
  // stage cover + backlight, so the three can never show different tracks. The old
  // per-surface settle debounce intentionally lagged the background onto a different
  // (skipped/previous) song than the cover — that WAS the QA misalignment. The
  // transport throttle now bounds the switch rate, so following the live index no
  // longer floods the cover/Pixi pipeline. See PRD Phase 8 (single-clock).
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const visualizerStyle = resolveVisualizerStyle(settings.visualizerStyle);
  const videoTrack = current?.kind === "video";
  // Immersive video lives in the BACKGROUND now (the foreground card always shows the
  // cover). When the set is in video mode and the current track is a playable video,
  // the shared <video> mounts full-bleed here (NowPlayingVideoBackdrop); the existing
  // cover-background video paths are suppressed so the file is only ever decoded once.
  const videoBackdropActive = !!current && displayMode === "video" && trackIsPlayableVideo(current);
  const imageMaskOpacity = videoTrack
    ? (settings.videoTrackBackgroundMaskOpacity ?? 25) / 100
    : (settings.backgroundMaskOpacity ?? 25) / 100;
  const imageMaskBlur = videoTrack
    ? (settings.videoTrackBackgroundMaskBlur ?? 0)
    : (settings.backgroundMaskBlur ?? 0);
  const videoTrackVisualizerEnabled = videoTrack
    ? immersive
      ? (settings.immersiveVideoTrackVisualizerEnabled ?? false)
      : (settings.videoTrackVisualizerEnabled ?? true)
    : true;
  const videoTrackFlowEnabled = videoTrack
    ? immersive
      ? (settings.immersiveVideoTrackFlowEnabled ?? false)
      : (settings.videoTrackFlowEnabled ?? true)
    : true;
  const videoTrackBackgroundEffectsEnabled = videoTrack
    ? immersive
      ? (settings.immersiveVideoTrackBackgroundEffectsEnabled ?? false)
      : (settings.videoTrackBackgroundEffectsEnabled ?? true)
    : true;
  const showViz =
    !hideVisualizer &&
    !!current &&
    videoTrackVisualizerEnabled &&
    (settings.visualizerAsBackground ?? true) &&
    visualizerStyle !== "off";
  // "Has lyrics" is decided by the TRACK itself (does it have displayable
  // lyrics?), not the lyrics-display toggle — so the visualizer auto-subdues
  // whenever there are words to read. The 240ms opacity transitions below make
  // the switch glide.
  const lyricsRow = useLiveQuery(
    () => (current?.id ? getTrackLyrics(current.id) : Promise.resolve(undefined)),
    [current?.id],
    undefined,
  );
  const lyricsMode = resolveTrackLyrics(current, lyricsRow).mode;
  const hasLyrics = lyricsMode === "synced" || lyricsMode === "plain";
  const visualizerComposite = resolveVisualizerBackgroundCompositeOptions(
    settings,
    visualizerStyle,
    hasLyrics,
  );
  const visualizerDim = visualizerComposite.dimPct / 100;
  const visualizerOpacity = visualizerComposite.opacityPct / 100;
  // Electron + file-backed cover: load the cover via the local-media protocol so
  // Chromium decodes/caches it natively instead of blob → object URL → a JS-heap
  // bitmap. The background is full-bleed/blurred, so the raw (uncropped) file is
  // fine. When it's available we skip resolving the object-URL cover entirely (no
  // blob load); everywhere else we fall back to it. See the local-media PRD.
  const localCover = useLocalCoverResource(current);
  const waitForLocalCoverUrl = localCover.pending && !localCover.url;
  const coverResource = useTrackCoverResource(
    localCover.url || waitForLocalCoverUrl ? undefined : current,
  );
  const coverResourceMatchesTrack =
    !coverResource.url ||
    !coverResource.targetKey ||
    coverResource.urlKey === coverResource.targetKey;
  const backgroundCoverUrl =
    localCover.url ??
    (!waitForLocalCoverUrl && coverResourceMatchesTrack ? coverResource.url : null);
  const trackBackgroundRows = useLiveQuery(
    () => (current?.id ? listTrackBackgroundRows(current.id) : Promise.resolve([])),
    [current?.id],
    [],
  );
  const galleryRows = useLiveQuery(() => listGalleryImageRows(), [], []);
  const source = resolveBackgroundSource({
    mode: settings.backgroundMode,
    galleryFallback: settings.backgroundGalleryFallback ?? true,
    hasCover: trackHasCover(current),
    trackBackgroundCount: trackBackgroundRows.length,
    galleryCount: galleryRows.length,
  });
  const clearCoverBackgroundWhileLoading =
    source === "cover" &&
    (waitForLocalCoverUrl ||
      Boolean(current?.remoteCoverUrl) ||
      current?.origin === "streamed" ||
      coverResource.staleWhilePending ||
      !coverResourceMatchesTrack);
  const holdCoverBackgroundWhileLoading = !clearCoverBackgroundWhileLoading;
  const renderer = videoTrackBackgroundEffectsEnabled
    ? (settings.backgroundRenderer ?? "noise")
    : "image";
  const blurPx = settings.backgroundBlur ?? 64;
  const pixelSize = settings.backgroundPixelSize ?? 12;
  const hasBackgroundVideoMedia = trackHasBackgroundVideoMedia(current);
  const showPlainVideoBackground =
    videoTrack &&
    !videoTrackBackgroundEffectsEnabled &&
    settings.backgroundMode !== "none" &&
    hasBackgroundVideoMedia &&
    !videoBackdropActive;
  const pixiMediaRaw = resolvePixiBackgroundMedia({
    imageSource: source,
    mode: settings.backgroundMode,
    trackKind: current?.kind,
    trackStatus: current?.status,
    hasTrackMedia: hasBackgroundVideoMedia,
  });
  // The immersive video now lives ONLY in NowPlayingVideoBackdrop. The Pixi cover-effect
  // background must never sample the track video itself — that was a second decode that
  // also ran in cover mode (periodic GPU-video bursts). Force it to the cover image.
  const pixiMedia =
    pixiMediaRaw.source === "track-video" ? { source, mediaType: "image" as const } : pixiMediaRaw;
  const pixiEffect = isPixiEffect(renderer, pixiMedia.mediaType) ? renderer : null;
  // When a playable video is the backdrop AND the user keeps background effects on for
  // video, sample the SHARED MediaEngine <video> through Pixi so the selected filter
  // applies to the MOVING picture (a single decode — the element is already decoded for
  // playback). `renderer` is already gated by videoTrackBackgroundEffectsEnabled: when
  // effects are off it's "image", which isPixiEffect rejects for video, so the raw
  // NowPlayingVideoBackdrop shows instead. Immersive defaults effects off → clean video.
  const videoFilterEffect =
    videoBackdropActive && isPixiEffect(renderer, "video") ? renderer : null;
  const sharedVideoElement = videoFilterEffect ? (getMediaEngine()?.element ?? null) : null;
  // The Pixi background uses the ORIGINAL cover (loaded below, capped at 1024px),
  // NOT a cropped 192px `backlight` derivative. The noise/pixel renderers don't blur
  // the cover — they lay an effect over it — so a tiny upscaled texture looks soft,
  // and the original (the SAME bitmap the foreground coverflow already decoded) is
  // sharp, GPU-scaled (object-fit cover) for free, and skips the derivative worker
  // pass + its separate load entirely (cheaper end-to-end, like the library grid).
  const coverBackgroundLoadUrl = backgroundCoverUrl;

  useEffect(() => {
    if (source !== "cover" || !waitForLocalCoverUrl || !current?.coverBlobId) return;
    bgCoverLog.debug("localCover.wait", {
      canServeLocalCover: localCover.canServe,
      category: "performance",
      coverBlobId: current.coverBlobId,
      fallback: "object-url",
      pendingReason: localCover.pendingReason,
      phase: "skip",
      trackId: current.id,
    });
  }, [
    current?.coverBlobId,
    current?.id,
    localCover.canServe,
    localCover.pendingReason,
    source,
    waitForLocalCoverUrl,
  ]);
  const localCoverFallbackReason =
    source === "cover" &&
    current?.coverBlobId &&
    !waitForLocalCoverUrl &&
    !localCover.url &&
    coverResource.url &&
    coverResourceMatchesTrack
      ? localCover.canServe === false
        ? "unservable-row"
        : localCover.canServe === true
          ? "protocol-url-failed"
          : "unknown"
      : null;
  useEffect(() => {
    if (!localCoverFallbackReason || !current?.coverBlobId) return;
    bgCoverLog.debug("localCover.fallback", {
      canServeLocalCover: localCover.canServe,
      category: "performance",
      coverBlobId: current.coverBlobId,
      coverResourceReady: Boolean(coverResource.url),
      coverResourceStaleWhilePending: coverResource.staleWhilePending,
      fallback: "object-url",
      phase: "state",
      reason: localCoverFallbackReason,
      trackId: current.id,
    });
  }, [
    coverResource.staleWhilePending,
    coverResource.url,
    current?.coverBlobId,
    current?.id,
    localCover.canServe,
    localCoverFallbackReason,
  ]);
  const shouldLoadCoverForImageRenderer =
    source === "cover" && (!pixiEffect || pixiMedia.source !== "cover");
  const loadedCoverBackground = useLoadedImageUrl(
    shouldLoadCoverForImageRenderer ? coverBackgroundLoadUrl : null,
    {
      holdPreviousWhileLoading: holdCoverBackgroundWhileLoading,
      trace: {
        source,
        surface: "background",
        trackId: current?.id,
        // When Pixi renders the background, the decoded <img> below is gated out
        // (!pixiEffect) — so an image.load/decode logged with pixiActive:true is a
        // wasted full-image decode (switch-fps Phase 4, §2.5 double-decode probe).
        pixiActive: Boolean(pixiEffect),
      },
    },
  );
  const slideshowRows =
    source === "track-slideshow"
      ? trackBackgroundRows
      : source === "gallery-slideshow"
        ? galleryRows
        : [];
  const [slideIndex, setSlideIndex] = useState(0);
  const slideshowRow =
    slideshowRows.length > 0 ? (slideshowRows[slideIndex % slideshowRows.length] ?? null) : null;
  const slideshowUrl = useMediaBlobUrl(slideshowRow);
  const documentHidden = useDocumentHidden();
  const currentVideoUrl = useTrackMediaUrl(
    (pixiEffect && hasBackgroundVideoMedia) || showPlainVideoBackground ? current : undefined,
  );
  const effectSettings = useMemo(
    () => ({
      backgroundAsciiColor: settings.backgroundAsciiColor,
      backgroundAsciiReplaceColor: settings.backgroundAsciiReplaceColor,
      backgroundBlur: settings.backgroundBlur,
      backgroundCrtCurvature: settings.backgroundCrtCurvature,
      backgroundCrtLineContrast: settings.backgroundCrtLineContrast,
      backgroundCrtLineWidth: settings.backgroundCrtLineWidth,
      backgroundCrtNoise: settings.backgroundCrtNoise,
      backgroundCrtNoiseSize: settings.backgroundCrtNoiseSize,
      backgroundCrtSeed: settings.backgroundCrtSeed,
      backgroundCrtTime: settings.backgroundCrtTime,
      backgroundCrtVerticalLine: settings.backgroundCrtVerticalLine,
      backgroundCrtVignetting: settings.backgroundCrtVignetting,
      backgroundCrtVignettingAlpha: settings.backgroundCrtVignettingAlpha,
      backgroundCrtVignettingBlur: settings.backgroundCrtVignettingBlur,
      backgroundDotAngle: settings.backgroundDotAngle,
      backgroundDotGrayscale: settings.backgroundDotGrayscale,
      backgroundDotScale: settings.backgroundDotScale,
      backgroundNoiseAmount: settings.backgroundNoiseAmount,
      backgroundNoiseSeed: settings.backgroundNoiseSeed,
    }),
    [
      settings.backgroundAsciiColor,
      settings.backgroundAsciiReplaceColor,
      settings.backgroundBlur,
      settings.backgroundCrtCurvature,
      settings.backgroundCrtLineContrast,
      settings.backgroundCrtLineWidth,
      settings.backgroundCrtNoise,
      settings.backgroundCrtNoiseSize,
      settings.backgroundCrtSeed,
      settings.backgroundCrtTime,
      settings.backgroundCrtVerticalLine,
      settings.backgroundCrtVignetting,
      settings.backgroundCrtVignettingAlpha,
      settings.backgroundCrtVignettingBlur,
      settings.backgroundDotAngle,
      settings.backgroundDotGrayscale,
      settings.backgroundDotScale,
      settings.backgroundNoiseAmount,
      settings.backgroundNoiseSeed,
    ],
  );
  const backgroundUrl = source === "cover" ? loadedCoverBackground.displayUrl : slideshowUrl;
  const pixiCoverUrl = pixiMedia.source === "cover" ? backgroundCoverUrl : backgroundUrl;
  const pixiUrl =
    pixiMedia.source === "track-video" && !videoBackdropActive ? currentVideoUrl : pixiCoverUrl;
  const hasPotentialImageBackground =
    source === "cover"
      ? trackHasCover(current)
      : source === "track-slideshow"
        ? trackBackgroundRows.length > 0
        : source === "gallery-slideshow"
          ? galleryRows.length > 0
          : false;
  const hasPendingImageBackground =
    source === "cover"
      ? holdCoverBackgroundWhileLoading && hasPotentialImageBackground
      : hasPotentialImageBackground;
  const hasPendingBackground =
    pixiMedia.source === "track-video" ? hasBackgroundVideoMedia : hasPendingImageBackground;
  const imageTarget = useMemo<BackgroundRenderTarget | null>(
    () => (backgroundUrl ? { mediaType: "image", src: backgroundUrl } : null),
    [backgroundUrl],
  );
  const pixiTarget = useMemo<BackgroundRenderTarget | null>(
    () => (pixiUrl ? { mediaType: pixiMedia.mediaType, src: pixiUrl } : null),
    [pixiMedia.mediaType, pixiUrl],
  );
  const renderImageTarget = useSettledBackgroundTarget(imageTarget, hasPendingImageBackground);
  const renderPixiTarget = useSettledBackgroundTarget(pixiTarget, hasPendingBackground);
  const suppressCoverTargetWhileLocalPending =
    source === "cover" && pixiMedia.source === "cover" && waitForLocalCoverUrl;
  const effectiveRenderImageTarget = suppressCoverTargetWhileLocalPending
    ? null
    : renderImageTarget;
  const effectiveRenderPixiTarget = suppressCoverTargetWhileLocalPending ? null : renderPixiTarget;
  const shouldKeepPixiMounted =
    pixiMedia.source === "track-video" ? hasBackgroundVideoMedia : hasPotentialImageBackground;
  // Hold the Pixi layer VISIBLE while a switch's incoming cover resolves, instead of
  // dropping to opacity-0 — the dark drop was the "black flash on commit". The Pixi
  // controller KEEPS its last texture on a transient null src, so holding the layer
  // visible shows that previous cover until the new one lands. We only hide for a
  // genuinely REMOTE/stale cover (where flashing the previous would be a wrong cover
  // from another source) — that's what clearCoverBackgroundWhileLoading guards. A
  // LOCAL cover whose protocol URL is briefly resolving (waitForLocalCoverUrl) is the
  // SAME track's art, so it holds. Video keeps the strict gate.
  // Only a genuinely REMOTE/streamed cover risks holding a wrong-SOURCE image while the
  // incoming one resolves — those still hide. A LOCAL cover's held texture is always
  // this track's (or the immediately-previous) art, and the Pixi controller holds its
  // last texture / the lockstep window on a transient null src. The old broader guard
  // (`staleWhilePending || !coverResourceMatchesTrack`) flipped against holding on the
  // A→B object-URL transition at a coverflow commit — dropping the layer to opacity-0
  // for the frames until B's object URL resolved = the "commit 后过渡到黑再 fade in"
  // full-screen flash (PRD 20260618). Holding local covers visible lets the controller
  // bridge the gap instead. (Was masked by the title flash until that was fixed.)
  const isRemoteOrStaleCover = Boolean(current?.remoteCoverUrl) || current?.origin === "streamed";
  // While the lockstep cover window is open (a coverflow drag + its post-commit
  // hand-off, up until clearWindow), the Pixi controller is painting the window's
  // covers into the canvas. The resting-cover gates below (pixiHoldsCover /
  // effectiveRenderPixiTarget) can briefly go false mid-switch — for a STREAMED
  // track the new cover proxies in over ~300ms — and that flipped the layer's CSS
  // to opacity-0, blacking out a canvas that still had the window covers in it (the
  // reported full-screen "commit 后过渡到黑再 fade in"). Keep the layer visible while
  // the window owns the canvas. (PRD 20260618 #3.)
  const coverWindowActive = useSyncExternalStore(
    subscribeWindow,
    () => getCoverWindow().active,
    () => false,
  );
  const pixiHoldsCover =
    pixiMedia.source !== "track-video" && hasPotentialImageBackground && !isRemoteOrStaleCover;
  const slideshowResetKey = `${current?.id ?? ""}:${source}:${slideshowRows.length}`;

  useEffect(() => {
    if (slideshowResetKey) setSlideIndex(Math.max(0, slideshowRows.length - 1));
  }, [slideshowResetKey, slideshowRows.length]);

  useEffect(() => {
    if (
      !shouldRunBackgroundSlideshow({
        documentHidden,
        slideCount: slideshowRows.length,
      })
    ) {
      return;
    }
    const sec = Math.max(5, settings.backgroundSlideshowIntervalSec ?? 300);
    const id = window.setInterval(() => {
      setSlideIndex((currentIndex) =>
        nextSlideIndex(
          currentIndex,
          slideshowRows.length,
          settings.backgroundSlideshowShuffle ?? true,
        ),
      );
    }, sec * 1000);
    return () => window.clearInterval(id);
  }, [
    settings.backgroundSlideshowIntervalSec,
    settings.backgroundSlideshowShuffle,
    documentHidden,
    slideshowRows.length,
  ]);

  // Background Frame Controller (PRD Phase 3, blur + cover slice). Drive the blur
  // background through the unified layer-stack crossfade. `backgroundCoverUrl` is
  // already track-bound and null while a switch resolves, so the controller never
  // pairs a stale cover with the wrong track and holds the previous frame until
  // the new one is ready (no flash). Pixi / plain / slideshow stay on the old path.
  const useControllerBlur =
    renderer === "blur" && source === "cover" && pixiMedia.source !== "track-video";
  const backgroundFrameSpec = useMemo(
    () =>
      current
        ? resolveBackgroundFrameSpec({
            trackId: current.id,
            mode: settings.backgroundMode,
            renderer,
            galleryFallback: settings.backgroundGalleryFallback ?? true,
            hasCover: trackHasCover(current),
            trackBackgroundCount: trackBackgroundRows.length,
            galleryCount: galleryRows.length,
            trackKind: current.kind,
            trackStatus: current.status,
            hasTrackVideo: hasBackgroundVideoMedia,
          })
        : null,
    [
      current,
      settings.backgroundMode,
      settings.backgroundGalleryFallback,
      renderer,
      trackBackgroundRows.length,
      galleryRows.length,
      hasBackgroundVideoMedia,
    ],
  );
  const { layers: backgroundLayers, settleTop: settleBackgroundTop } = useBackgroundController({
    trackId: current?.id,
    spec: backgroundFrameSpec,
    coverUrl: useControllerBlur ? backgroundCoverUrl : null,
  });

  return (
    <>
      {/* The cover-effect background (Pixi / blur / image) sits BELOW the full-bleed
          video backdrop. When the backdrop is active it's fully occluded, so skip it
          entirely — this unmounts the Pixi WebGL renderer (~240 MB VRAM) with no visual
          change, since the opaque video covers exactly this layer. (Live-video Pixi
          filtering, when enabled, is a SEPARATE layer mounted above the backdrop below.) */}
      {videoBackdropActive ? null : useControllerBlur ? (
        // The whole cover group composites at ONE opacity (COVER_GROUP_OPACITY = 1,
        // full), with each layer at full opacity inside it. A crossfade then stays
        // fully opaque throughout — the top cover fully covers the base — so there's
        // no brightness spike from two semi-transparent layers overlapping (QA: image
        // brightens then dims back). The drag transition lives in the SAME group so it
        // matches the resting cover.
        <div className="absolute inset-0" style={{ opacity: COVER_GROUP_OPACITY }}>
          <BackgroundFrameStack
            blurPx={blurPx}
            layers={backgroundLayers}
            maxOpacity={1}
            onTopSettled={settleBackgroundTop}
          />
          <TransitionBackground blurPx={blurPx} maxOpacity={1} />
        </div>
      ) : showPlainVideoBackground && currentVideoUrl ? (
        <PlainBackgroundVideo key={currentVideoUrl} src={currentVideoUrl} />
      ) : effectiveRenderImageTarget && renderer === "blur" && !pixiEffect ? (
        <CanvasBlurBackground
          blurPx={blurPx}
          holdPreviousWhileLoading={source !== "cover" || holdCoverBackgroundWhileLoading}
          src={effectiveRenderImageTarget.src}
        />
      ) : (effectiveRenderPixiTarget || shouldKeepPixiMounted) &&
        pixiEffect &&
        ENABLE_PIXI_BACKGROUND_FOR_BISECT ? (
        <PixiPixelBackground
          // Show the cover layer at FULL opacity so a cover→cover crossfade is a true
          // 0→100% handoff (the incoming fully replaces the outgoing — no residual);
          // dimming, if any, is the separate imageMask below, not a cap on this layer.
          // Hold it VISIBLE (opacity-100, previous cover) while a switch's incoming
          // cover resolves rather than dropping to opacity-0 — the dark gap was the
          // post-commit flicker — mirroring 均衡's hold-previous frame controller. Video
          // keeps the old gate (no stale cover while a video texture loads).
          className={
            effectiveRenderPixiTarget || pixiHoldsCover || coverWindowActive
              ? "opacity-100"
              : "opacity-0"
          }
          effect={pixiEffect}
          effectSettings={effectSettings}
          mediaType={effectiveRenderPixiTarget?.mediaType ?? pixiMedia.mediaType}
          pixelSize={pixelSize}
          src={
            DISABLE_PIXI_TEXTURE_SOURCE_FOR_BISECT ? null : (effectiveRenderPixiTarget?.src ?? null)
          }
        />
      ) : effectiveRenderImageTarget && !pixiEffect ? (
        <CrossfadeBackgroundImage
          holdPreviousWhileLoading={source !== "cover" || holdCoverBackgroundWhileLoading}
          src={effectiveRenderImageTarget.src}
        />
      ) : null}
      {/* Immersive video background: the shared media <video>, mounted full-bleed when
          the set is in video mode and the current track is a playable video. The
          foreground card shows the cover; the moving picture lives here, above the
          (occluded) cover effect and below the flow + spectrum. This is ALSO the decode
          anchor for the live-video Pixi filter below: keeping it mounted guarantees the
          element keeps decoding, and the opaque filter layer simply paints over it (one
          decode). When the filter can't init you gracefully see the raw video instead. */}
      <NowPlayingVideoBackdrop active={videoBackdropActive} />
      {/* Live-video Pixi filter: when background effects stay ON for the video, sample
          the SAME shared <video> as a texture and render the selected filter (crt / pixel
          / noise / blur / …) OPAQUE over the raw backdrop above — so the moving picture
          itself is filtered, with no second decode. Sits below the dim/flow/spectrum. */}
      {videoFilterEffect && sharedVideoElement ? (
        <PixiPixelBackground
          key="pixi-video"
          className="opacity-100"
          effect={videoFilterEffect}
          effectSettings={effectSettings}
          mediaType="video"
          pixelSize={pixelSize}
          src={null}
          videoElement={sharedVideoElement}
        />
      ) : null}
      {/* PM ask: the dim layer can also blur the backdrop (image/video/Pixi below
          it) so a bright cover softens behind the foreground. This MUST be its own
          transparent layer — putting `backdrop-filter` on the opaque `bg-background`
          tint below would paint the dim color OVER the blurred backdrop, then group
          opacity reveals the ORIGINAL (un-blurred) cover, so the blur shows nothing.
          A bare backdrop-filter layer has no background to cover its result. 0 = off. */}
      {imageMaskBlur > 0 ? (
        <div
          data-testid="background-mask-blur"
          className="absolute inset-0"
          style={{
            backdropFilter: `blur(${imageMaskBlur}px)`,
            WebkitBackdropFilter: `blur(${imageMaskBlur}px)`,
          }}
        />
      ) : null}
      <div
        data-testid="background-mask"
        className="absolute inset-0 bg-background"
        style={{ opacity: imageMaskOpacity }}
      />
      {/* Independent 流光 layer: composited ABOVE the background image/video and
          BELOW the visualizer spectrum. It's its own toggle (flowEnabled), NOT a
          visualizer style — flow and the spectrum coexist. Forces styleId so it
          renders flow regardless of the chosen visualizer. */}
      <AnimatePresence>
        {!!current && videoTrackFlowEnabled && (settings.flowEnabled ?? false) && (
          <motion.div
            // Key by effect so switching effects crossfades (old shader fades out
            // while the new fades in) instead of popping on recompile. Song
            // changes keep the same key → same canvas → colors glide via the
            // cover-palette store's 900ms interpolation (same as the spectrum).
            key={`flow-${settings.flowEffect ?? "ambient-light"}`}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          >
            <VisualizerHost
              active={isPlaying}
              styleId="scene-flow"
              coverColor
              placement="background"
              className="absolute inset-0"
              style={{
                opacity: (settings.flowOpacity ?? FLOW_DEFAULTS.opacity) / 100,
                // Composite the flow with the background below it (add/multiply/…)
                // via the native compositor — same result as Pixi blend modes.
                mixBlendMode: settings.flowBlendMode ?? FLOW_DEFAULTS.blendMode,
              }}
            />
            <div
              className="absolute inset-0 bg-background"
              style={{ opacity: (settings.flowDim ?? FLOW_DEFAULTS.dim) / 100 }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {/* Fade the whole visualizer layer in/out when the mode toggles (V / the
          mode button) instead of popping. AnimatePresence runs the exit fade
          before unmount; the inner per-frame opacity/dim still apply on top. */}
      <AnimatePresence>
        {showViz && (
          <motion.div
            key="visualizer-layer"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
          >
            <VisualizerHost
              active={isPlaying}
              className="absolute inset-0"
              coverColor
              placement="background"
              style={{
                opacity: visualizerOpacity,
                transition: "opacity 240ms ease",
                // Blend the spectrum (a canvas) with the flow + background below it.
                mixBlendMode: settings.visualizerBlendMode ?? VISUALIZER_BLEND_DEFAULT,
              }}
            />
            {/* Always rendered (opacity 0 when off) so the dim eases in/out smoothly
                instead of popping when you raise it to read lyrics over the viz. */}
            <div
              className="absolute inset-0 bg-background"
              style={{ opacity: visualizerDim, transition: "opacity 240ms ease" }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {/* The standalone drag-follow (PRD Phase 2-D) is intentionally OFF: it was
          never synced to the foreground coverflow or the Frame Controller, which
          caused the drag artifacts QA found — B not reaching 100% (mapping
          mismatch), and a flash back to A on release (handoff desync). The
          drag-follow returns properly in Phase 4, driven by the same Transition
          Driver as the foreground so they share progress + endpoints. */}
    </>
  );
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() =>
    typeof document === "undefined" ? false : document.hidden,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return hidden;
}

function useSettledBackgroundTarget<T extends BackgroundRenderTarget>(
  target: T | null,
  hasPendingSource: boolean,
): T | null {
  const [settled, setSettled] = useState<T | null>(target);

  // Settle DURING RENDER on an input change rather than in a useEffect — the effect
  // forced an extra render + commit on every track switch (react-doctor no-derived-state).
  // The functional updater keeps the prev-`settled` dependency, so hold-previous-while-
  // pending behavior is unchanged; React just re-renders synchronously without the
  // stale intermediate commit.
  const [prevInputs, setPrevInputs] = useState({ hasPendingSource, target });
  if (target !== prevInputs.target || hasPendingSource !== prevInputs.hasPendingSource) {
    setPrevInputs({ hasPendingSource, target });
    setSettled((current) => settleBackgroundTarget(current, target, hasPendingSource));
  }

  return settled;
}

function CrossfadeBackgroundImage({
  holdPreviousWhileLoading = true,
  src,
}: {
  holdPreviousWhileLoading?: boolean;
  src: string;
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(src);

  useEffect(() => {
    if (src === loadedSrc) return;
    let alive = true;
    if (!holdPreviousWhileLoading) setLoadedSrc(null);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (alive) setLoadedSrc(src);
    };
    image.onerror = () => {
      if (alive) setLoadedSrc(holdPreviousWhileLoading ? src : null);
    };
    image.src = src;
    return () => {
      alive = false;
    };
  }, [holdPreviousWhileLoading, loadedSrc, src]);

  return (
    <AnimatePresence initial={false}>
      {loadedSrc ? (
        <motion.img
          key={loadedSrc}
          src={loadedSrc}
          alt=""
          decoding="async"
          draggable={false}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </AnimatePresence>
  );
}

function PlainBackgroundVideo({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const sync = () => {
      const { isPlaying, positionSec } = usePlayerStore.getState();
      if (Number.isFinite(positionSec) && Math.abs(video.currentTime - positionSec) > 0.45) {
        video.currentTime = Math.max(0, positionSec);
      }
      if (isPlaying) void video.play()?.catch(() => undefined);
      else video.pause();
    };

    sync();
    const unsubscribe = usePlayerStore.subscribe((state, prev) => {
      if (state.currentIndex !== prev.currentIndex || state.positionSec !== prev.positionSec) {
        if (Math.abs(video.currentTime - state.positionSec) > 0.45) {
          video.currentTime = Math.max(0, state.positionSec);
        }
      }
      if (state.isPlaying !== prev.isPlaying) {
        if (state.isPlaying) void video.play()?.catch(() => undefined);
        else video.pause();
      }
    });
    video.addEventListener("loadedmetadata", sync);
    return () => {
      unsubscribe();
      video.removeEventListener("loadedmetadata", sync);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      preload="auto"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

/**
 * Immersive full-bleed video background. Adopts the SINGLE persistent media `<video>`
 * (the same element the audio driver is synced to) into a full-bleed layer while the
 * set is in video mode and the current track is a playable video — so the moving
 * picture lives behind the now-playing content with no extra decode. When inactive it
 * releases the element back to the hidden host; the store also disables the element via
 * setVideoEnabled in cover mode, so a video file shown as a cover stops decoding.
 */
function NowPlayingVideoBackdrop({ active }: { active: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const engine = getMediaEngine();
    const host = hostRef.current;
    if (!engine || !host) return;
    engine.mount(host);
    engine.element.className = "absolute inset-0 h-full w-full bg-black object-cover";
    return () => {
      const released = getMediaEngine();
      if (!released) return;
      released.unmount();
      released.element.className = "pointer-events-none absolute h-0 w-0 opacity-0";
    };
  }, [active]);
  return active ? (
    <div ref={hostRef} aria-hidden className="absolute inset-0 overflow-hidden bg-black" />
  ) : null;
}

function isPixiEffect(
  renderer: string,
  mediaType: "image" | "video",
): renderer is PixiBackgroundEffect {
  if (renderer === "blur") return mediaType === "video";
  return ["pixel", "ascii", "cross-hatch", "crt", "dot", "noise"].includes(renderer);
}
