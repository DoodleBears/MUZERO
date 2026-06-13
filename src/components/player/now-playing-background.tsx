import { useLiveQuery } from "dexie-react-hooks";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { getTrackLyrics, listGalleryImages, listTrackBackgrounds } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { useLocalCoverUrl } from "@/hooks/use-local-cover";
import { useObjectUrls, useTrackCoverUrl, useTrackMediaUrl } from "@/hooks/use-media";
import {
  type BackgroundRenderTarget,
  resolveBackgroundSource,
  resolvePixiBackgroundMedia,
  settleBackgroundTarget,
  trackHasBackgroundVideoMedia,
} from "@/lib/background";
import { FLOW_DEFAULTS, VISUALIZER_BLEND_DEFAULT } from "@/lib/flow-config";
import { nextSlideIndex } from "@/lib/slideshow";
import { trackHasCover } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import { resolveVisualizerBackgroundCompositeOptions } from "@/lib/visualizer-effect-settings";
import { resolveTrackLyrics } from "@/lyrics/resolve-lyrics";
import { usePlayerStore } from "@/stores/player-store";
import { VisualizerHost } from "@/visualizer/host";
import { resolveVisualizerStyle } from "@/visualizer/registry";
import { CanvasBlurBackground } from "./canvas-blur-background";
import { type PixiBackgroundEffect, PixiPixelBackground } from "./pixi-pixel-background";

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
  const localCoverUrl = useLocalCoverUrl(current);
  const coverUrl = useTrackCoverUrl(localCoverUrl ? undefined : current);
  const backgroundCoverUrl = localCoverUrl ?? coverUrl;
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
  const slideshowUrls =
    source === "track-slideshow"
      ? trackBackgroundUrls
      : source === "gallery-slideshow"
        ? galleryUrls
        : [];
  const [slideIndex, setSlideIndex] = useState(0);
  const renderer = settings.backgroundRenderer ?? "noise";
  const blurPx = settings.backgroundBlur ?? 64;
  const pixelSize = settings.backgroundPixelSize ?? 12;
  const pixiEffect = isPixiEffect(renderer) ? renderer : null;
  const hasBackgroundVideoMedia = trackHasBackgroundVideoMedia(current);
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
      ? backgroundCoverUrl
      : slideshowUrls.length > 0
        ? (slideshowUrls[slideIndex % slideshowUrls.length] ?? null)
        : null;
  const pixiMedia = resolvePixiBackgroundMedia({
    imageSource: source,
    mode: settings.backgroundMode,
    trackKind: current?.kind,
    trackStatus: current?.status,
    hasTrackMedia: hasBackgroundVideoMedia,
  });
  const pixiUrl = pixiMedia.source === "track-video" ? currentVideoUrl : backgroundUrl;
  const hasPendingImageBackground =
    source === "cover"
      ? trackHasCover(current)
      : source === "track-slideshow"
        ? trackBackgroundBlobs.length > 0
        : source === "gallery-slideshow"
          ? galleryBlobs.length > 0
          : false;
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

  return (
    <>
      {renderImageTarget && renderer === "blur" ? (
        <CanvasBlurBackground blurPx={blurPx} src={renderImageTarget.src} />
      ) : (renderPixiTarget || hasPendingBackground) && pixiEffect ? (
        <PixiPixelBackground
          className="opacity-90"
          effect={pixiEffect}
          effectSettings={effectSettings}
          mediaType={renderPixiTarget?.mediaType ?? pixiMedia.mediaType}
          pixelSize={pixelSize}
          src={renderPixiTarget?.src ?? null}
        />
      ) : renderImageTarget ? (
        <CrossfadeBackgroundImage src={renderImageTarget.src} />
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
    </>
  );
}

function useSettledBackgroundTarget<T extends BackgroundRenderTarget>(
  target: T | null,
  hasPendingSource: boolean,
): T | null {
  const [settled, setSettled] = useState<T | null>(target);

  useEffect(() => {
    setSettled((current) => settleBackgroundTarget(current, target, hasPendingSource));
  }, [target, hasPendingSource]);

  return settled;
}

function CrossfadeBackgroundImage({ src }: { src: string }) {
  const [loadedSrc, setLoadedSrc] = useState(src);

  useEffect(() => {
    if (src === loadedSrc) return;
    let alive = true;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (alive) setLoadedSrc(src);
    };
    image.onerror = () => {
      if (alive) setLoadedSrc(src);
    };
    image.src = src;
    return () => {
      alive = false;
    };
  }, [loadedSrc, src]);

  return (
    <AnimatePresence initial={false}>
      <motion.img
        key={loadedSrc}
        src={loadedSrc}
        alt=""
        decoding="async"
        draggable={false}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.9 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.35 }}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </AnimatePresence>
  );
}

function isPixiEffect(renderer: string): renderer is PixiBackgroundEffect {
  return ["pixel", "ascii", "cross-hatch", "crt", "dot", "noise"].includes(renderer);
}
