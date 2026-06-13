import { useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/hooks/use-app-data";
import { useSettledValue } from "@/hooks/use-settled-value";
import { BACKGROUND_EFFECT_SETTLE_MS } from "@/lib/background";
import {
  type BackgroundEffectSettings,
  resolvePixiBackgroundEffectOptions,
} from "@/lib/background-effect-settings";
import { hasWebGpuSupport, resolveGpuBackend, resolveGpuPower } from "@/lib/gpu-backend";
import { log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import {
  type AttachVideo,
  createPixiBackgroundController,
  type PixiBackgroundController,
  type PixiModuleLike,
} from "./pixi-background-controller";

export type PixiBackgroundEffect = "pixel" | "ascii" | "cross-hatch" | "crt" | "dot" | "noise";
type BackgroundMediaType = "image" | "video";

/**
 * Wire a freshly-loaded video texture to playback: seek to the current position,
 * follow play/pause + scrub from the store, and drive the layer ticker only while
 * the video is actually progressing. Returns a teardown that unwires the events;
 * the controller releases the element itself via disposeMedia.
 */
const attachVideo: AttachVideo = async ({ app, video, render }) => {
  const { isPlaying, positionSec } = usePlayerStore.getState();
  await prepareVideoFrame(video, positionSec);
  // A paused seek decodes a new frame while the ticker is stopped — repaint once
  // per decoded frame so the frozen background tracks it.
  const onSeeked = () => {
    if (!usePlayerStore.getState().isPlaying) render();
  };
  video.addEventListener("seeked", onSeeked);
  if (isPlaying) void video.play().catch(() => {});
  syncLayerTicker({ app, media: video }, isPlaying);
  const unsubscribe = usePlayerStore.subscribe((state, prev) => {
    if (state.currentIndex !== prev.currentIndex) {
      syncVideo(video, state.positionSec, true);
    } else if (state.positionSec !== prev.positionSec) {
      syncVideo(video, state.positionSec);
    }
    if (state.isPlaying !== prev.isPlaying) {
      if (state.isPlaying) void video.play().catch(() => {});
      else video.pause();
      syncLayerTicker({ app, media: video }, state.isPlaying);
      // Pausing freezes the ticker — paint the frame we stopped on.
      if (!state.isPlaying) render();
    }
  });
  return () => {
    unsubscribe();
    video.removeEventListener("seeked", onSeeked);
  };
};

export function PixiPixelBackground({
  className,
  effect = "pixel",
  effectSettings,
  mediaType = "image",
  pixelSize,
  src,
}: {
  className?: string;
  effect?: PixiBackgroundEffect;
  effectSettings: BackgroundEffectSettings;
  mediaType?: BackgroundMediaType;
  pixelSize: number;
  src: string | null;
}) {
  const settings = useSettings();
  const gpuBackend = useMemo(
    () => resolveGpuBackend(settings.backgroundGpuBackend, hasWebGpuSupport()),
    [settings.backgroundGpuBackend],
  );
  const gpuPower = resolveGpuPower(settings.backgroundGpuPowerPreference);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [controller, setController] = useState<PixiBackgroundController | null>(null);
  // The src actually painted onto the Pixi texture. While it lags the current
  // `src` (during a switch / rapid skip), the plain <img> below stays visible.
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(null);
  // Heavy work (texture load + upload + effect) is gated behind a quiet period so a
  // rapid next/next burst never uploads textures for the songs it skipped past. The
  // plain <img> still follows the raw `src` every switch. See PRD Phase 2.
  const settledSrc = useSettledValue(src, BACKGROUND_EFFECT_SETTLE_MS);
  const effectOptions = useMemo(
    () => resolvePixiBackgroundEffectOptions(effectSettings, pixelSize),
    [effectSettings, pixelSize],
  );

  // App lifecycle: the persistent Pixi app/sprite/filter is (re)built ONLY when
  // the effect, its options, or the render block size change — i.e. settings, not
  // track switches. A song change just swaps the texture (effect below), so we no
  // longer tear down and recreate the WebGL context + recompile the filter on
  // every covered switch (the dominant switch-jank cost). See PRD Phase 1.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setDisplayedSrc(null);
    const next = createPixiBackgroundController({
      host,
      effect,
      effectOptions,
      pixelSize,
      preference: gpuBackend,
      powerPreference: gpuPower,
      deps: {
        loadPixi: async () => (await import("pixi.js")) as unknown as PixiModuleLike,
        loadMedia: (pixi, source, type) =>
          loadBackgroundMedia(pixi as unknown as typeof import("pixi.js"), source, type),
        loadFilter: (_pixi, fx, opts) =>
          createPixiFilter(fx, opts as ReturnType<typeof resolvePixiBackgroundEffectOptions>),
        attachVideo,
        onError: (err) => log.warn("background", "Pixi background failed", err),
      },
    });
    setController(next);
    return () => {
      setController(null);
      next.destroy();
    };
  }, [effect, effectOptions, pixelSize, gpuBackend, gpuPower]);

  // Texture swap: only the SETTLED src reaches the persistent app, so skipped-past
  // songs never upload a texture. Re-runs when the controller is rebuilt so the new
  // controller is seeded. On apply, record displayedSrc to fade out the plain <img>.
  useEffect(() => {
    if (!controller) return;
    let cancelled = false;
    void controller.setSource(settledSrc, mediaType).then(() => {
      if (!cancelled) setDisplayedSrc(settledSrc);
    });
    return () => {
      cancelled = true;
    };
  }, [controller, settledSrc, mediaType]);

  return (
    <div
      ref={hostRef}
      className={cn("absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
    >
      {mediaType === "image" && src ? (
        <img
          src={src}
          alt=""
          decoding="async"
          className={cn(
            // Reveal layer ON TOP of the canvas (z-10 vs the canvas's z-0): the plain
            // cover shows instantly on a switch while the heavy effect computes below,
            // then fades out to reveal the effect instead of popping it in (#3).
            "absolute inset-0 z-10 h-full w-full object-cover transition-opacity duration-500",
            src === displayedSrc ? "opacity-0" : "opacity-100",
          )}
        />
      ) : null}
    </div>
  );
}

/**
 * Drive the layer's ticker (which re-renders the stage every frame) only while
 * a video is actually progressing. Static covers — the common noise/CRT-over-
 * image case — and paused MVs render on demand (resize / seeked / pause paint)
 * instead of burning GPU at 60fps (memory-perf-audit PRD F-6).
 */
export function syncLayerTicker(
  layer: {
    media?: HTMLVideoElement;
    app: { ticker: Pick<import("pixi.js").Ticker, "start" | "stop" | "started"> };
  },
  isPlaying: boolean,
): void {
  const ticker = layer.app.ticker;
  if (layer.media && isPlaying) {
    if (!ticker.started) ticker.start();
  } else if (ticker.started) {
    ticker.stop();
  }
}

async function createPixiFilter(
  effect: PixiBackgroundEffect,
  options: ReturnType<typeof resolvePixiBackgroundEffectOptions>,
): Promise<import("pixi.js").Filter | null> {
  switch (effect) {
    case "ascii": {
      const { AsciiFilter } = await import("pixi-filters/ascii");
      return new AsciiFilter(options.ascii);
    }
    case "cross-hatch": {
      const { CrossHatchFilter } = await import("pixi-filters/cross-hatch");
      return new CrossHatchFilter();
    }
    case "crt": {
      const { CRTFilter } = await import("pixi-filters/crt");
      return new CRTFilter(options.crt);
    }
    case "dot": {
      const { DotFilter } = await import("pixi-filters/dot");
      return new DotFilter(options.dot);
    }
    case "noise": {
      const { NoiseFilter } = await import("pixi.js");
      return new NoiseFilter(options.noise);
    }
    default:
      return null;
  }
}

type BackgroundMedia =
  | {
      element: HTMLImageElement;
      height: number;
      texture?: import("pixi.js").Texture;
      type: "image";
      unload?: () => void;
      width: number;
    }
  | {
      element: HTMLVideoElement;
      height: number;
      texture: import("pixi.js").Texture;
      type: "video";
      unload?: undefined;
      width: number;
    };

async function loadBackgroundMedia(
  Pixi: typeof import("pixi.js"),
  src: string,
  mediaType: BackgroundMediaType,
): Promise<BackgroundMedia> {
  if (mediaType === "video") return loadVideo(Pixi, src);
  const resolved = await resolveImageTextureSource(src);
  const image = await loadImage(resolved.src);
  return {
    element: image,
    height: image.naturalHeight,
    type: "image",
    unload: resolved.unload,
    width: image.naturalWidth,
  };
}

async function resolveImageTextureSource(
  src: string,
): Promise<{ src: string; unload?: () => void }> {
  if (!shouldFetchImageTexture(src)) return { src };
  try {
    const fetcher = await getAppFetch();
    // `cache: "no-store"` avoids reusing a prior no-CORS <img> cache entry for
    // the same public R2 URL. The texture then reads from a same-origin blob URL.
    const response = await fetcher(src, { cache: "no-store" });
    if (!response.ok) return { src };
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size === 0) return { src };
    const objectUrl = URL.createObjectURL(blob);
    return {
      src: objectUrl,
      unload: () => URL.revokeObjectURL(objectUrl),
    };
  } catch {
    return { src };
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    // Cross-origin covers must opt into CORS to become a WebGL texture. On
    // Electron remote covers arrive proxied (muzfetch: returns ACAO:*); in the
    // BROWSER there is no media proxy, so cloud-share / streamed covers come as
    // raw https — without crossOrigin the upload taints, Pixi throws, and the
    // whole filter layer silently falls back to the plain <img> (the "filters
    // work on Electron but not in Chrome" regression). Hosts without ACAO fail
    // the load instead and hit the same plain-image fallback as before.
    if (needsCrossOrigin(src)) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load background image: ${src}`));
    image.src = src;
    if (image.decode) {
      void image.decode().then(
        () => resolve(image),
        () => {
          // Safari/WKWebView can reject decode() for images that still fire onload;
          // leave onload/onerror as the source of truth.
        },
      );
    }
  });
}

async function loadVideo(Pixi: typeof import("pixi.js"), src: string): Promise<BackgroundMedia> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.preload = "auto";
  // R2/public cloud videos are cross-origin. Pixi/WebGL needs a CORS-clean media
  // element to sample video frames as a texture; otherwise Chrome can play the
  // <video> but render a blank/black background texture.
  if (needsCrossOrigin(src)) video.crossOrigin = "anonymous";
  video.src = src;
  video.load();
  await waitForVideoData(video);
  if (!video.videoWidth || !video.videoHeight) {
    await Promise.race([waitForEvent(video, "loadedmetadata"), delay(500)]);
  }
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error(`Unable to load background video: ${src}`);
  }
  const texture = Pixi.Texture.from(video, true);
  return {
    element: video,
    height: video.videoHeight,
    texture,
    type: "video",
    width: video.videoWidth,
  };
}

/** Shared CORS opt-in for both texture loaders — see the loadImage comment. */
export function needsCrossOrigin(src: string): boolean {
  return /^(https?|muzfetch):/i.test(src);
}

export function shouldFetchImageTexture(src: string): boolean {
  return /^https?:/i.test(src);
}

function syncVideo(video: HTMLVideoElement, positionSec: number, force = false) {
  if (!Number.isFinite(positionSec)) return;
  const drift = Math.abs(video.currentTime - positionSec);
  if (force || drift > 0.35) video.currentTime = positionSec;
}

async function prepareVideoFrame(video: HTMLVideoElement, positionSec: number) {
  await waitForVideoData(video);
  try {
    syncVideo(video, positionSec, true);
  } catch {
    // Some partially loaded WebView video resources reject seeking briefly. The
    // background can still fade in once the first decoded frame is available.
  }
  await Promise.race([
    waitForVideoData(video),
    waitForEvent(video, "seeked"),
    waitForEvent(video, "timeupdate"),
    delay(300),
  ]);
  await waitForPresentedFrame(video);
}

function waitForVideoData(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return Promise.race([
    waitForEvent(video, "loadeddata"),
    waitForEvent(video, "canplay"),
    delay(500),
  ]);
}

function waitForPresentedFrame(video: HTMLVideoElement) {
  if (!("requestVideoFrameCallback" in video)) {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    video.requestVideoFrameCallback(() => finish());
    window.setTimeout(finish, 500);
  });
}

function waitForEvent(target: EventTarget, event: string) {
  return new Promise<void>((resolve) => {
    target.addEventListener(event, () => resolve(), { once: true });
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}
