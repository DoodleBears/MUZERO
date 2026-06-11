import { useEffect, useMemo, useRef, useState } from "react";
import {
  type BackgroundEffectSettings,
  resolvePixiBackgroundEffectOptions,
} from "@/lib/background-effect-settings";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

export type PixiBackgroundEffect = "pixel" | "ascii" | "cross-hatch" | "crt" | "dot" | "noise";
type BackgroundMediaType = "image" | "video";

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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const currentLayerRef = useRef<PixiLayer | null>(null);
  const [hasLayer, setHasLayer] = useState(false);
  const effectOptions = useMemo(
    () => resolvePixiBackgroundEffectOptions(effectSettings, pixelSize),
    [effectSettings, pixelSize],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!src) {
      // A null src can be a transient "next blob URL is still resolving" state
      // during track changes. Keep the painted layer alive; the parent unmounts
      // this component when there is genuinely no background source left.
      return;
    }

    let disposed = false;
    let pendingLayer: PixiLayer | null = null;

    void (async () => {
      try {
        const Pixi = await import("pixi.js");
        if (disposed || !hostRef.current) return;

        const nextApp = new Pixi.Application();
        await nextApp.init({
          antialias: false,
          autoDensity: false,
          // The ticker re-renders every frame — needed only while a video is
          // progressing. Static covers (noise/CRT) render on demand in resize();
          // syncLayerTicker starts/stops it with playback (PRD F-6).
          autoStart: false,
          backgroundAlpha: 0,
          height: 1,
          powerPreference: "low-power",
          preference: "webgl",
          resolution: 1,
          width: 1,
        });
        if (disposed || !hostRef.current) {
          nextApp.destroy({ removeView: true }, { children: true, context: true });
          return;
        }

        const canvas = nextApp.canvas;
        canvas.style.position = "absolute";
        canvas.style.inset = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.imageRendering = effect === "pixel" ? "pixelated" : "auto";
        canvas.style.opacity = "0";
        canvas.style.transition = "opacity 300ms ease";

        const media = await loadBackgroundMedia(Pixi, src, mediaType);
        if (disposed || !hostRef.current) {
          destroyBackgroundMedia(media);
          nextApp.destroy(
            { removeView: true },
            { children: true, context: true, texture: true, textureSource: true },
          );
          return;
        }

        const texture = media.texture ?? Pixi.Texture.from(media.element, true);
        texture.source.scaleMode = "nearest";
        const sprite = new Pixi.Sprite(texture);
        const filter = await createPixiFilter(effect, effectOptions);
        if (disposed || !hostRef.current) {
          destroyBackgroundMedia(media);
          nextApp.destroy(
            { removeView: true },
            { children: true, context: true, texture: true, textureSource: true },
          );
          return;
        }
        if (filter) sprite.filters = [filter];
        nextApp.stage.addChild(sprite);
        if (media.type === "video") {
          const video = media.element;
          const { isPlaying, positionSec } = usePlayerStore.getState();
          await prepareVideoFrame(video, positionSec);
          if (disposed || !hostRef.current) {
            destroyBackgroundMedia(media);
            nextApp.destroy(
              { removeView: true },
              { children: true, context: true, texture: true, textureSource: true },
            );
            return;
          }
          // A paused seek decodes a new frame while the ticker is stopped —
          // repaint once per decoded frame so the frozen background tracks it.
          video.addEventListener("seeked", () => {
            if (!usePlayerStore.getState().isPlaying) nextApp.render();
          });
          if (isPlaying) void video.play().catch(() => {});
        }

        const resize = () => {
          const container = hostRef.current;
          if (!container || disposed) return;
          const cssW = Math.max(1, Math.round(container.clientWidth));
          const cssH = Math.max(1, Math.round(container.clientHeight));
          const block = Math.max(3, Math.min(48, Math.round(pixelSize)));
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const renderW =
            effect === "pixel" ? Math.max(1, Math.round(cssW / block)) : Math.round(cssW * dpr);
          const renderH =
            effect === "pixel" ? Math.max(1, Math.round(cssH / block)) : Math.round(cssH * dpr);
          nextApp.renderer.resize(renderW, renderH);
          coverSprite(sprite, media.width, media.height, renderW, renderH);
          nextApp.render();
        };

        resize();
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(hostRef.current);
        pendingLayer = {
          app: nextApp,
          canvas,
          media: media.type === "video" ? media.element : undefined,
          resizeObserver,
          unload: media.unload,
        };
        syncLayerTicker(pendingLayer, usePlayerStore.getState().isPlaying);
        const previousLayer = currentLayerRef.current;
        currentLayerRef.current = pendingLayer;
        hostRef.current.appendChild(canvas);
        requestAnimationFrame(() => {
          if (disposed) return;
          if (previousLayer && currentLayerRef.current !== previousLayer) {
            previousLayer.canvas.style.opacity = "0";
          }
          canvas.style.opacity = "1";
        });
        window.setTimeout(() => {
          if (previousLayer && currentLayerRef.current !== previousLayer) {
            destroyPixiLayer(previousLayer);
          }
        }, 350);
        setHasLayer(true);
      } catch (err) {
        log.warn("background", "Pixi pixel video background failed", err);
        if (mediaType === "video") {
          const currentLayer = currentLayerRef.current;
          if (currentLayer) {
            currentLayerRef.current = null;
            destroyPixiLayer(currentLayer);
          }
        }
        if (!currentLayerRef.current) setHasLayer(false);
      }
    })();

    return () => {
      disposed = true;
      if (pendingLayer && currentLayerRef.current !== pendingLayer) {
        destroyPixiLayer(pendingLayer);
      }
    };
  }, [src, mediaType, pixelSize, effect, effectOptions]);

  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      const layer = currentLayerRef.current;
      const video = layer?.media;
      if (!layer || !video) return;
      if (state.currentIndex !== prev.currentIndex) syncVideo(video, state.positionSec, true);
      else syncVideo(video, state.positionSec);
      if (state.isPlaying !== prev.isPlaying) {
        if (state.isPlaying) void video.play().catch(() => {});
        else video.pause();
        syncLayerTicker(layer, state.isPlaying);
        // Pausing freezes the ticker — paint the frame we stopped on.
        if (!state.isPlaying) layer.app.render();
      }
    });
  }, []);

  useEffect(
    () => () => {
      if (currentLayerRef.current) {
        destroyPixiLayer(currentLayerRef.current);
        currentLayerRef.current = null;
      }
    },
    [],
  );

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
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            hasLayer ? "opacity-0" : "opacity-90",
          )}
        />
      ) : null}
    </div>
  );
}

type PixiLayer = {
  app: import("pixi.js").Application;
  canvas: HTMLCanvasElement;
  media?: HTMLVideoElement;
  resizeObserver: ResizeObserver;
  unload?: () => void;
};

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

function destroyPixiLayer(layer: PixiLayer) {
  layer.resizeObserver.disconnect();
  if (layer.media) destroyVideo(layer.media);
  layer.app.destroy(
    { removeView: true },
    { children: true, context: true, texture: !layer.unload, textureSource: !layer.unload },
  );
  layer.unload?.();
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
      unload?: undefined;
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
  const image = await loadImage(src);
  return {
    element: image,
    height: image.naturalHeight,
    type: "image",
    width: image.naturalWidth,
  };
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

function destroyBackgroundMedia(media: BackgroundMedia) {
  if (media.type === "video") destroyVideo(media.element);
}

function destroyVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute("src");
  video.load();
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

function coverSprite(
  sprite: import("pixi.js").Sprite,
  textureWidth: number,
  textureHeight: number,
  width: number,
  height: number,
) {
  const sourceW = Math.max(1, textureWidth);
  const sourceH = Math.max(1, textureHeight);
  const scale = Math.max(width / sourceW, height / sourceH);
  const drawW = sourceW * scale;
  const drawH = sourceH * scale;
  sprite.scale.set(scale);
  sprite.position.set((width - drawW) / 2, (height - drawH) / 2);
}
