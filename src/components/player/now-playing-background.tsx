import { useMemo } from "react";
import { useSettings } from "@/hooks/use-app-data";
import { useTrackCoverUrl } from "@/hooks/use-media";
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
  className,
  idle: _idle = false,
}: {
  className?: string;
  idle?: boolean;
}) {
  const settings = useSettings();
  const imageMaskOpacity = (settings.backgroundMaskOpacity ?? 25) / 100;
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const showViz =
    !!current &&
    (settings.visualizerAsBackground ?? true) &&
    (settings.visualizerStyle ?? "bars") !== "off";
  const visualizerDim = (settings.visualizerBackgroundDim ?? 0) / 100;
  const visualizerOpacity = (settings.visualizerBackgroundOpacity ?? 100) / 100;
  const coverUrl = useTrackCoverUrl(current);
  const renderer = settings.backgroundRenderer ?? "noise";
  const blurPx = settings.backgroundBlur ?? 64;
  const pixelSize = settings.backgroundPixelSize ?? 12;
  const pixiEffect = isPixiEffect(renderer) ? renderer : null;
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

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden bg-background",
        className,
      )}
      aria-hidden="true"
    >
      {coverUrl && renderer === "blur" ? (
        <CanvasBlurBackground blurPx={blurPx} src={coverUrl} />
      ) : coverUrl && pixiEffect ? (
        <PixiPixelBackground
          className="opacity-90"
          effect={pixiEffect}
          effectSettings={effectSettings}
          pixelSize={pixelSize}
          src={coverUrl}
        />
      ) : coverUrl ? (
        <img
          key={coverUrl}
          src={coverUrl}
          alt=""
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover opacity-90 transition-opacity duration-300"
        />
      ) : null}
      <div className="absolute inset-0 bg-background" style={{ opacity: imageMaskOpacity }} />
      {showViz ? (
        <>
          <VisualizerHost
            active={isPlaying}
            className="absolute inset-0"
            coverColor
            placement="background"
            style={{ opacity: visualizerOpacity }}
          />
          {visualizerDim > 0 ? (
            <div className="absolute inset-0 bg-background" style={{ opacity: visualizerDim }} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function isPixiEffect(renderer: string): renderer is PixiBackgroundEffect {
  return ["pixel", "ascii", "cross-hatch", "crt", "dot", "noise"].includes(renderer);
}
