import { useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/hooks/use-app-data";
import { useRedrawOnViewportResize } from "@/hooks/use-redraw-on-viewport-resize";
import {
  type BackgroundEffectSettings,
  resolvePixiBackgroundEffectOptions,
} from "@/lib/background-effect-settings";
import { type ImageBitmapBlobSource, loadImageBitmapSource } from "@/lib/background-texture";
import { hasWebGpuSupport, resolveGpuBackend, resolveGpuPower } from "@/lib/gpu-backend";
import { createDiagnosticLogger, log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { coverWindowOffset, getCoverWindow, subscribeWindow } from "./cover-window-store";
import {
  type AttachVideo,
  createPixiBackgroundController,
  type PixiBackgroundController,
  type PixiModuleLike,
} from "./pixi-background-controller";

export type PixiBackgroundEffect =
  | "blur"
  | "pixel"
  | "ascii"
  | "cross-hatch"
  | "crt"
  | "dot"
  | "noise";
type BackgroundMediaType = "image" | "video";
const BACKGROUND_TEXTURE_LOAD_DELAY_MS = 180;
// Cover→cover crossfade duration: the incoming cover fades in as a 2nd sprite under the
// SAME resident filter, so the effect is preserved throughout and covers dissolve instead
// of the old plain-<img> reveal. PM: dragging to switch should crossfade the background.
// Kept just above the 200ms transport cap so a single switch reads as a smooth dissolve
// while held Q/E (5/s) stays in step with the cover — a newer switch finalizes the prior
// crossfade, so it never falls behind the current track ("背景过渡也是").
const BACKGROUND_COVER_CROSSFADE_MS = 240;
const TEXTURE_HEADER_BYTES = 64 * 1024;
const bgTextureLog = createDiagnosticLogger("background.texture");

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

/**
 * Wire the SHARED MediaEngine `<video>` as a live texture WITHOUT controlling its
 * playback — the player engine already drives play/seek/sync to the audio driver.
 * We only run the layer ticker while it's progressing, and repaint once on a paused
 * seek / fresh frame so a frozen background tracks the new frame. Returns a teardown.
 */
const attachSharedVideo: AttachVideo = ({ app, video, render }) => {
  const { isPlaying } = usePlayerStore.getState();
  syncLayerTicker({ app, media: video }, isPlaying);
  if (!isPlaying) render();
  const repaintWhenPaused = () => {
    if (!usePlayerStore.getState().isPlaying) render();
  };
  video.addEventListener("seeked", repaintWhenPaused);
  video.addEventListener("loadeddata", repaintWhenPaused);
  const unsubscribe = usePlayerStore.subscribe((state, prev) => {
    if (state.isPlaying !== prev.isPlaying) {
      syncLayerTicker({ app, media: video }, state.isPlaying);
      if (!state.isPlaying) render();
    }
  });
  return () => {
    unsubscribe();
    video.removeEventListener("seeked", repaintWhenPaused);
    video.removeEventListener("loadeddata", repaintWhenPaused);
  };
};

/**
 * Build a Pixi texture sampling the SHARED MediaEngine `<video>` without taking over
 * its playback. `VideoSource` defaults to autoPlay + autoLoad ON — autoPlay would
 * resume a user-paused video (desyncing it from the audio driver) and autoLoad would
 * re-`load()` the element (resetting its position). Both OFF: the element is already
 * loaded and driven by MediaEngine; Pixi only re-uploads the current frame each render
 * while it's playing (updateFPS 0 = every frame).
 */
function createSharedVideoTexture(
  Pixi: typeof import("pixi.js"),
  element: HTMLVideoElement,
): import("pixi.js").Texture {
  // autoLoad MUST stay on (default): VideoSource.load() is what attaches the play/seeked
  // listeners and starts the per-frame texture upload (rVFC) — without it the texture
  // freezes on the first frame. It does NOT reset the element here: load() only calls
  // `element.load()` when the element isn't yet valid, and we only sample an already-
  // loaded+playing element (the component waits for dimensions first). autoPlay stays OFF
  // so Pixi never resumes a user-paused video (the player engine owns play/pause).
  const source = new Pixi.VideoSource({
    autoPlay: false,
    resource: element,
    updateFPS: 0,
  });
  // CRITICAL: Pixi's VideoSource.destroy() runs `resource.pause(); resource.src = "";
  // resource.load()` — which would RESET the shared MediaEngine <video> (owned by the
  // player engine, NOT Pixi) and fire a MEDIA_ELEMENT_ERROR + stop playback. Detach the
  // element before Pixi's teardown: disable autoUpdate first so the ticker/rVFC unhook
  // cleanly from the REAL element, then null `resource` so destroy() skips the element
  // teardown entirely (it guards on `if (source)`). The shared element keeps playing.
  const patchable = source as unknown as {
    resource: HTMLVideoElement | null;
    autoUpdate: boolean;
    destroy: () => void;
  };
  const baseDestroy = patchable.destroy.bind(source);
  patchable.destroy = () => {
    patchable.autoUpdate = false;
    if (patchable.resource === element) patchable.resource = null;
    baseDestroy();
  };
  return new Pixi.Texture({ source });
}

/**
 * Wait until the shared element can be sampled as a texture: intrinsic size (to
 * cover-fit its sprite) AND a DECODED, presentable frame.
 *
 * WebGPU's `copyExternalImageToTexture` REJECTS a `<video>` that has no current frame
 * ("doesn't have back resource") — where WebGL silently uploads a black frame — so
 * attaching + force-rendering (setVideoElement → resize → render) before the first
 * frame decodes throws an unhandled rejection on the WebGPU backend at boot / first
 * mount (worst on a cold start, when the blob decodes slowly). It's harmless — playback
 * is MediaEngine-driven and the very next render uploads fine — but noisy. Gating the
 * attach on a presented frame closes it; afterwards Pixi's VideoSource only re-uploads
 * on rVFC (real frames), so ongoing renders can't hit a frameless element. Every wait is
 * bounded (mirrors {@link prepareVideoFrame}) so a stalled source can't hang the effect.
 */
async function ensureVideoTextureReady(video: HTMLVideoElement): Promise<void> {
  if (!video.videoWidth || !video.videoHeight) {
    await Promise.race([
      waitForEvent(video, "loadedmetadata"),
      waitForEvent(video, "loadeddata"),
      delay(500),
    ]);
  }
  await waitForVideoData(video); // readyState >= HAVE_CURRENT_DATA (a renderable frame)
  await waitForPresentedFrame(video); // the compositor actually holds a decoded frame (rVFC)
}

export function PixiPixelBackground({
  className,
  effect = "pixel",
  effectSettings,
  mediaType = "image",
  pixelSize,
  src,
  videoElement,
}: {
  className?: string;
  effect?: PixiBackgroundEffect;
  effectSettings: BackgroundEffectSettings;
  mediaType?: BackgroundMediaType;
  pixelSize: number;
  src: string | null;
  /**
   * The shared MediaEngine `<video>` to sample as a live texture (single decode).
   * When set with `mediaType="video"`, the filter applies to the moving picture and
   * `src` is ignored. Omitted everywhere else (cover/image backgrounds use `src`).
   */
  videoElement?: HTMLVideoElement | null;
}) {
  const settings = useSettings();
  const gpuBackend = useMemo(
    () => resolveGpuBackend(settings.backgroundGpuBackend, hasWebGpuSupport()),
    [settings.backgroundGpuBackend],
  );
  const gpuPower = resolveGpuPower(settings.backgroundGpuPowerPreference);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [controller, setController] = useState<PixiBackgroundController | null>(null);
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
    const next = createPixiBackgroundController({
      host,
      effect,
      effectOptions,
      crossfadeMs: BACKGROUND_COVER_CROSSFADE_MS,
      loadDelayMs: BACKGROUND_TEXTURE_LOAD_DELAY_MS,
      pixelSize,
      preference: gpuBackend,
      powerPreference: gpuPower,
      deps: {
        loadPixi: async () => (await import("pixi.js")) as unknown as PixiModuleLike,
        loadMedia: (pixi, source, type, options) =>
          loadBackgroundMedia(
            pixi as unknown as typeof import("pixi.js"),
            source,
            type,
            options.signal,
          ),
        loadFilter: (_pixi, fx, opts) =>
          createPixiFilter(fx, opts as ReturnType<typeof resolvePixiBackgroundEffectOptions>),
        attachVideo,
        attachSharedVideo,
        createSharedVideoTexture: (pixiMod, element) =>
          createSharedVideoTexture(pixiMod as unknown as typeof import("pixi.js"), element),
        onError: (err) => log.warn("background", "Pixi background failed", err),
      },
    });
    setController(next);
    return () => {
      setController(null);
      next.destroy();
    };
  }, [effect, effectOptions, pixelSize, gpuBackend, gpuPower]);

  // Maximize / fullscreen jump the window size in one step; redraw immediately on the
  // pre-paint resize event so the canvas isn't left CSS-stretched for a frame. The
  // controller's own ResizeObserver still covers element-box changes (panel toggles).
  useRedrawOnViewportResize(() => controller?.resize());

  // Texture swap follows `src` directly (no debounce) so the background switches
  // together with the cover — single source of truth (PRD Phase 8). The transport
  // throttle bounds the switch rate, so we no longer gate uploads here. Re-runs when
  // the controller is rebuilt. The incoming cover crossfades in as a 2nd sprite under
  // the resident filter (controller crossfadeMs), so no plain-<img> reveal is needed.
  useEffect(() => {
    if (!controller) return;
    void controller.setSource(src, mediaType);
  }, [controller, src, mediaType]);

  // Live-video path: sample the SHARED MediaEngine `<video>` as the texture so the
  // filter applies to the moving picture with a single decode. A track change swaps
  // the element's src under the player engine and the live texture follows, so this
  // only re-runs when the element identity (or media kind) changes. Null tears it down.
  useEffect(() => {
    if (!controller) return;
    if (mediaType !== "video" || !videoElement) {
      void controller.setVideoElement(null);
      return;
    }
    let alive = true;
    void (async () => {
      await ensureVideoTextureReady(videoElement);
      if (alive) await controller.setVideoElement(videoElement);
    })();
    return () => {
      alive = false;
      void controller.setVideoElement(null);
    };
  }, [controller, videoElement, mediaType]);

  // Lockstep cover window: mirror the foreground coverflow. While the shared cover
  // window is active, reconcile the controller's sprite RING to the window slots and
  // drive their translate off the shared `coverWindowOffset` MotionValue (off the
  // React render path) — so the background covers slide WITH the foreground, neighbour
  // for neighbour, through a continuous drag. Image backgrounds only; video / non-image
  // covers never enter window mode and fall back to the single-sprite `setSource` path.
  useEffect(() => {
    if (!controller || mediaType !== "image") return;
    const syncWindow = () => {
      const w = getCoverWindow();
      if (w.active && w.slots.length > 0) {
        void controller.setWindow(
          w.slots.map((slot) => ({ offsetSteps: slot.offsetSteps, src: slot.coverUrl })),
        );
      } else {
        controller.clearWindow();
      }
    };
    const applyOffset = (steps: number) => {
      if (getCoverWindow().active) controller.setWindowOffset(steps);
    };
    syncWindow();
    applyOffset(coverWindowOffset.get());
    const unsubWindow = subscribeWindow(syncWindow);
    const unsubOffset = coverWindowOffset.on("change", applyOffset);
    return () => {
      unsubWindow();
      unsubOffset();
      controller.clearWindow();
    };
  }, [controller, mediaType]);

  return (
    <div
      ref={hostRef}
      className={cn("absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
    />
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
    case "blur": {
      const { BlurFilter } = await import("pixi.js");
      const strength = options.blur.strength;
      if (strength <= 0) return null;
      const filter = new BlurFilter({ kernelSize: 5, quality: 4, strength });
      filter.repeatEdgePixels = true;
      return filter;
    }
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
      bytes?: number;
      element: HTMLImageElement | ImageBitmap;
      height: number;
      loader: "imageBitmap" | "imageElement";
      resizeMaxDimension?: number;
      sourceHeight?: number;
      sourceWidth?: number;
      texture?: import("pixi.js").Texture;
      type: "image";
      unload?: () => void;
      width: number;
    }
  | {
      element: HTMLVideoElement;
      height: number;
      loader: "videoElement";
      texture: import("pixi.js").Texture;
      type: "video";
      unload?: undefined;
      width: number;
    };

async function loadBackgroundMedia(
  Pixi: typeof import("pixi.js"),
  src: string,
  mediaType: BackgroundMediaType,
  signal?: AbortSignal,
): Promise<BackgroundMedia> {
  if (mediaType === "video") return loadVideo(Pixi, src);
  const sourceKind = classifyTextureSource(src);
  // Prefer an ImageBitmap texture source: createImageBitmap decodes off the main
  // thread and Pixi uploads the ImageBitmap directly — no "Image element passed,
  // converting to canvas and replacing resource" main-thread copy on the landing
  // frame (PRD Phase 4). The ambient background now uses the ORIGINAL cover at full
  // resolution (no cap) — it no longer samples the full video as a texture, so the cover
  // is just a small static image and full-res costs only a few MB.
  const bitmap = await loadImageBitmapSource(src, {
    createImageBitmap:
      typeof createImageBitmap === "function"
        ? (blob, options) => createImageBitmap(blob, options)
        : undefined,
    fetchBlob: fetchTextureBlob,
    onStage: (stage, context) =>
      bgTextureLog.debug(stage, {
        ...context,
        mediaType: "image",
        sourceKind,
      }),
    signal,
  });
  throwIfAborted(signal);
  if (bitmap) {
    return {
      bytes: bitmap.bytes,
      element: bitmap.bitmap,
      height: bitmap.height,
      loader: "imageBitmap",
      resizeMaxDimension: bitmap.resizeMaxDimension,
      sourceHeight: bitmap.sourceHeight,
      sourceWidth: bitmap.sourceWidth,
      type: "image",
      unload: bitmap.unload,
      width: bitmap.width,
    };
  }
  const resolved = await resolveImageTextureSource(src, signal);
  throwIfAborted(signal);
  const image = await loadImage(resolved.src, signal);
  return {
    element: image,
    height: image.naturalHeight,
    loader: "imageElement",
    type: "image",
    unload: resolved.unload,
    width: image.naturalWidth,
  };
}

/**
 * Resolve a background image src to its raw bytes for off-thread decode. Remote
 * (https / muzfetch) go through the desktop bridge fetch so CORS / mixed-content
 * is handled like the rest of the app; blob:/data: read directly. Returns null on
 * any failure so {@link loadBackgroundMedia} falls back to the <img> path.
 */
async function fetchTextureBlob(
  src: string,
  signal?: AbortSignal,
): Promise<ImageBitmapBlobSource | null> {
  try {
    throwIfAborted(signal);
    if (/^(blob:|data:)/i.test(src)) {
      const response = await fetch(src, { signal });
      return readTextureBlobSource(response, signal);
    }
    const fetcher = await getAppFetch();
    const response = await fetcher(src, { cache: "no-store", signal });
    return readTextureBlobSource(response, signal);
  } catch {
    return null;
  }
}

export async function readTextureBlobSource(
  response: Response,
  signal?: AbortSignal,
): Promise<ImageBitmapBlobSource | null> {
  if (!response.ok) return null;
  throwIfAborted(signal);
  const blob = await response.blob();
  throwIfAborted(signal);
  if (blob.size === 0) return null;
  const headerBytes = new Uint8Array(await blob.slice(0, TEXTURE_HEADER_BYTES).arrayBuffer());
  throwIfAborted(signal);
  return {
    blob,
    headerBytes,
    headerSource: "blob-slice",
  };
}

async function resolveImageTextureSource(
  src: string,
  signal?: AbortSignal,
): Promise<{ src: string; unload?: () => void }> {
  if (!shouldFetchImageTexture(src)) return { src };
  try {
    throwIfAborted(signal);
    const fetcher = await getAppFetch();
    // `cache: "no-store"` avoids reusing a prior no-CORS <img> cache entry for
    // the same public R2 URL. The texture then reads from a same-origin blob URL.
    const response = await fetcher(src, { cache: "no-store", signal });
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

function loadImage(src: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
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
    const abort = () => {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
      reject(createAbortError());
    };
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load background image: ${src}`));
    signal?.addEventListener("abort", abort, { once: true });
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function createAbortError(): DOMException {
  return new DOMException("Background texture load aborted", "AbortError");
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
    loader: "videoElement",
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

function classifyTextureSource(src: string): "blob" | "data" | "http" | "muzfetch" | "other" {
  if (/^blob:/i.test(src)) return "blob";
  if (/^data:/i.test(src)) return "data";
  if (/^https?:/i.test(src)) return "http";
  if (/^muzfetch:/i.test(src)) return "muzfetch";
  return "other";
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
