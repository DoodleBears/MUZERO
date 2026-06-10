import { useLiveQuery } from "dexie-react-hooks";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { listGalleryImages, listTrackBackgrounds } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { useObjectUrls, useTrackCoverUrl, useTrackMediaUrl } from "@/hooks/use-media";
import {
  type BackgroundRenderTarget,
  resolveBackgroundSource,
  resolvePixiBackgroundMedia,
  settleBackgroundTarget,
} from "@/lib/background";
import { nextSlideIndex } from "@/lib/slideshow";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { VisualizerHost } from "@/visualizer/host";
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
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden bg-background",
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
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const showViz =
    !hideVisualizer &&
    !!current &&
    (settings.visualizerAsBackground ?? false) &&
    (settings.visualizerStyle ?? "bars") !== "off";
  // When lyrics are shown over the visualizer, use the separate "with lyrics"
  // dim/opacity so the words stay readable. The 240ms opacity transitions below
  // make the switch glide.
  const lyricsActive = settings.lyricsStageOpen ?? false;
  const visualizerDim =
    (lyricsActive
      ? (settings.visualizerBgDimLyrics ?? 40)
      : (settings.visualizerBackgroundDim ?? 0)) / 100;
  const visualizerOpacity =
    (lyricsActive
      ? (settings.visualizerBgOpacityLyrics ?? 60)
      : (settings.visualizerBackgroundOpacity ?? 100)) / 100;
  const coverUrl = useTrackCoverUrl(current);
  const trackBackgrounds = useLiveQuery(
    () => (current?.id ? listTrackBackgrounds(current.id) : Promise.resolve([])),
    [current?.id],
    [],
  );
  const gallery = useLiveQuery(() => listGalleryImages(), [], []);
  const trackBackgroundBlobs = useMemo(
    () => trackBackgrounds.map((b) => b.blob),
    [trackBackgrounds],
  );
  const galleryBlobs = useMemo(() => gallery.map((b) => b.blob), [gallery]);
  const trackBackgroundUrls = useObjectUrls(trackBackgroundBlobs);
  const galleryUrls = useObjectUrls(galleryBlobs);
  const source = resolveBackgroundSource({
    mode: settings.backgroundMode,
    galleryFallback: settings.backgroundGalleryFallback ?? true,
    hasCover: !!current?.coverBlobId,
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
  const currentVideoUrl = useTrackMediaUrl(
    pixiEffect && current?.kind === "video" && current.status === "ready" ? current : undefined,
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
      ? coverUrl
      : slideshowUrls.length > 0
        ? (slideshowUrls[slideIndex % slideshowUrls.length] ?? null)
        : null;
  const pixiMedia = resolvePixiBackgroundMedia({
    imageSource: source,
    trackKind: current?.kind,
    trackStatus: current?.status,
    hasTrackMedia: !!current?.blobId,
  });
  const pixiUrl = pixiMedia.source === "track-video" ? currentVideoUrl : backgroundUrl;
  const hasPendingImageBackground =
    source === "cover"
      ? !!current?.coverBlobId
      : source === "track-slideshow"
        ? trackBackgroundBlobs.length > 0
        : source === "gallery-slideshow"
          ? galleryBlobs.length > 0
          : false;
  const hasPendingBackground =
    pixiMedia.source === "track-video" ? !!current?.blobId : hasPendingImageBackground;
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
      {showViz ? (
        <>
          <VisualizerHost
            active={isPlaying}
            className="absolute inset-0"
            coverColor
            placement="background"
            style={{ opacity: visualizerOpacity, transition: "opacity 240ms ease" }}
          />
          {/* Always rendered (opacity 0 when off) so the dim eases in/out smoothly
              instead of popping when you raise it to read lyrics over the viz. */}
          <div
            className="absolute inset-0 bg-background"
            style={{ opacity: visualizerDim, transition: "opacity 240ms ease" }}
          />
        </>
      ) : null}
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
