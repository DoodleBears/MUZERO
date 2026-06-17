import { useLiveQuery } from "dexie-react-hooks";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { getTrackLyrics, listGalleryImages, listTrackBackgrounds } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { useLoadedImageUrl } from "@/hooks/use-image-load";
import { useLocalCoverResource } from "@/hooks/use-local-cover";
import { useObjectUrls, useTrackCoverResource, useTrackMediaUrl } from "@/hooks/use-media";
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
import { trackHasCover } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import { resolveVisualizerBackgroundCompositeOptions } from "@/lib/visualizer-effect-settings";
import { resolveTrackLyrics } from "@/lyrics/resolve-lyrics";
import { usePlayerStore } from "@/stores/player-store";
import { VisualizerHost } from "@/visualizer/host";
import { resolveVisualizerStyle } from "@/visualizer/registry";
import { BackgroundFrameStack } from "./background/background-frame-stack";
import { TransitionBackground } from "./background/transition-background";
import { useBackgroundController } from "./background/use-background-controller";
import { CanvasBlurBackground } from "./canvas-blur-background";
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
  idle: _idle = false,
}: {
  active?: boolean;
  className?: string;
  hideVisualizer?: boolean;
  idle?: boolean;
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
      {active ? <NowPlayingBackgroundContent hideVisualizer={hideVisualizer} /> : null}
    </div>
  );
}

function NowPlayingBackgroundContent({ hideVisualizer }: { hideVisualizer: boolean }) {
  const settings = useSettings();
  const imageMaskOpacity = (settings.backgroundMaskOpacity ?? 25) / 100;
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  // Single source of truth: the ambient background reads the SAME live index as the
  // stage cover + backlight, so the three can never show different tracks. The old
  // per-surface settle debounce intentionally lagged the background onto a different
  // (skipped/previous) song than the cover — that WAS the QA misalignment. The
  // transport throttle now bounds the switch rate, so following the live index no
  // longer floods the cover/Pixi pipeline. See PRD Phase 8 (single-clock).
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const visualizerStyle = resolveVisualizerStyle(settings.visualizerStyle);
  const showViz =
    !hideVisualizer &&
    !!current &&
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
  const trackBackgrounds = useLiveQuery(
    () => (current?.id ? listTrackBackgrounds(current.id) : Promise.resolve([])),
    [current?.id],
    [],
  );
  const gallery = useLiveQuery(() => listGalleryImages(), [], []);
  const trackBackgroundBlobs = useMemo(
    () => trackBackgrounds.map((b) => b.blob).filter((blob): blob is Blob => Boolean(blob)),
    [trackBackgrounds],
  );
  const galleryBlobs = useMemo(
    () => gallery.map((b) => b.blob).filter((blob): blob is Blob => Boolean(blob)),
    [gallery],
  );
  const trackBackgroundUrls = useObjectUrls(trackBackgroundBlobs);
  const galleryUrls = useObjectUrls(galleryBlobs);
  const source = resolveBackgroundSource({
    mode: settings.backgroundMode,
    galleryFallback: settings.backgroundGalleryFallback ?? true,
    hasCover: trackHasCover(current),
    trackBackgroundCount: trackBackgroundBlobs.length,
    galleryCount: galleryBlobs.length,
  });
  const clearCoverBackgroundWhileLoading =
    source === "cover" &&
    (waitForLocalCoverUrl ||
      Boolean(current?.remoteCoverUrl) ||
      current?.origin === "streamed" ||
      coverResource.staleWhilePending ||
      !coverResourceMatchesTrack);
  const holdCoverBackgroundWhileLoading = !clearCoverBackgroundWhileLoading;
  const renderer = settings.backgroundRenderer ?? "noise";
  const blurPx = settings.backgroundBlur ?? 64;
  const pixelSize = settings.backgroundPixelSize ?? 12;
  const pixiEffect = isPixiEffect(renderer) ? renderer : null;
  const hasBackgroundVideoMedia = trackHasBackgroundVideoMedia(current);
  const pixiMedia = resolvePixiBackgroundMedia({
    imageSource: source,
    mode: settings.backgroundMode,
    trackKind: current?.kind,
    trackStatus: current?.status,
    hasTrackMedia: hasBackgroundVideoMedia,
  });
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
  const loadedCoverBackground = useLoadedImageUrl(coverBackgroundLoadUrl, {
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
  });
  const slideshowUrls =
    source === "track-slideshow"
      ? trackBackgroundUrls
      : source === "gallery-slideshow"
        ? galleryUrls
        : [];
  const [slideIndex, setSlideIndex] = useState(0);
  const currentVideoUrl = useTrackMediaUrl(
    pixiEffect && hasBackgroundVideoMedia ? current : undefined,
  );
  const effectSettings = useMemo(
    () => ({
      backgroundAsciiColor: settings.backgroundAsciiColor,
      backgroundAsciiReplaceColor: settings.backgroundAsciiReplaceColor,
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
  const backgroundUrl =
    source === "cover"
      ? loadedCoverBackground.displayUrl
      : slideshowUrls.length > 0
        ? (slideshowUrls[slideIndex % slideshowUrls.length] ?? null)
        : null;
  const pixiCoverUrl = backgroundUrl;
  const pixiUrl = pixiMedia.source === "track-video" ? currentVideoUrl : pixiCoverUrl;
  const hasPotentialImageBackground =
    source === "cover"
      ? trackHasCover(current)
      : source === "track-slideshow"
        ? trackBackgroundBlobs.length > 0
        : source === "gallery-slideshow"
          ? galleryBlobs.length > 0
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
  const pixiHoldsCover =
    pixiMedia.source !== "track-video" && hasPotentialImageBackground && !isRemoteOrStaleCover;
  const slideshowResetKey = `${current?.id ?? ""}:${source}:${slideshowUrls.length}`;

  useEffect(() => {
    if (slideshowResetKey) setSlideIndex(Math.max(0, slideshowUrls.length - 1));
  }, [slideshowResetKey, slideshowUrls.length]);

  useEffect(() => {
    if (slideshowUrls.length <= 1) return;
    const sec = Math.max(5, settings.backgroundSlideshowIntervalSec ?? 300);
    const id = window.setInterval(() => {
      setSlideIndex((currentIndex) =>
        nextSlideIndex(
          currentIndex,
          slideshowUrls.length,
          settings.backgroundSlideshowShuffle ?? true,
        ),
      );
    }, sec * 1000);
    return () => window.clearInterval(id);
  }, [
    settings.backgroundSlideshowIntervalSec,
    settings.backgroundSlideshowShuffle,
    slideshowUrls.length,
  ]);

  // Background Frame Controller (PRD Phase 3, blur + cover slice). Drive the blur
  // background through the unified layer-stack crossfade. `backgroundCoverUrl` is
  // already track-bound and null while a switch resolves, so the controller never
  // pairs a stale cover with the wrong track and holds the previous frame until
  // the new one is ready (no flash). Pixi / plain / slideshow stay on the old path.
  const useControllerBlur = renderer === "blur" && source === "cover";
  const backgroundFrameSpec = useMemo(
    () =>
      current
        ? resolveBackgroundFrameSpec({
            trackId: current.id,
            mode: settings.backgroundMode,
            renderer,
            galleryFallback: settings.backgroundGalleryFallback ?? true,
            hasCover: trackHasCover(current),
            trackBackgroundCount: trackBackgroundBlobs.length,
            galleryCount: galleryBlobs.length,
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
      trackBackgroundBlobs.length,
      galleryBlobs.length,
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
      {useControllerBlur ? (
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
      ) : effectiveRenderImageTarget && renderer === "blur" ? (
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
          className={effectiveRenderPixiTarget || pixiHoldsCover ? "opacity-100" : "opacity-0"}
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
      <div className="absolute inset-0 bg-background" style={{ opacity: imageMaskOpacity }} />
      {/* Independent 流光 layer: composited ABOVE the background image/video and
          BELOW the visualizer spectrum. It's its own toggle (flowEnabled), NOT a
          visualizer style — flow and the spectrum coexist. Forces styleId so it
          renders flow regardless of the chosen visualizer. */}
      <AnimatePresence>
        {!!current && (settings.flowEnabled ?? false) && (
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

function isPixiEffect(renderer: string): renderer is PixiBackgroundEffect {
  return ["pixel", "ascii", "cross-hatch", "crt", "dot", "noise"].includes(renderer);
}
