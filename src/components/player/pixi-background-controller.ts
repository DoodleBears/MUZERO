/**
 * Imperative lifecycle for the Now Playing Pixi ambient background, factored out
 * of the React component so the perf-critical invariant — **the WebGL app is
 * built once and only the texture is swapped on track switch** — is unit-testable
 * with an injected fake Pixi runtime (no real GPU/WebGL needed in jsdom).
 *
 * Before this controller the component re-ran `new Application()` + `await init()`
 * (GPU context creation) + filter (shader) compile on every `src` change, i.e.
 * every track switch with a different cover. That full teardown/rebuild was the
 * single heaviest synchronous operation on the switch hot path. Here the app,
 * sprite, and filter persist; `setSource()` only loads the next texture and
 * assigns `sprite.texture`, destroying the previous texture.
 *
 * Pixi is injected (`deps.loadPixi` / `loadMedia` / `loadFilter`) so the
 * component wires the real `pixi.js` import while tests inject a fake — mirroring
 * the DjBrain / MusicGenProvider DI pattern used elsewhere in the codebase.
 */
import type { PixiBackgroundEffect } from "./pixi-pixel-background";

export interface PixiTextureLike {
  source: { scaleMode: string };
  destroy(destroyBase?: boolean): void;
}

export interface PixiSpriteLike {
  texture: unknown;
  filters: unknown[];
  scale: { set(value: number): void };
  position: { set(x: number, y: number): void };
}

export interface PixiAppLike {
  init(options: Record<string, unknown>): Promise<void>;
  canvas: HTMLCanvasElement;
  stage: { addChild(child: unknown): void };
  renderer: { resize(width: number, height: number): void };
  ticker: { start(): void; stop(): void; started: boolean };
  render(): void;
  destroy(removeView: unknown, options: unknown): void;
}

export interface PixiModuleLike {
  Application: new () => PixiAppLike;
  Sprite: new (texture: unknown) => PixiSpriteLike;
  Texture: { from(source: unknown, skipCache?: boolean): PixiTextureLike };
}

export type BackgroundMediaType = "image" | "video";

export interface LoadedBackgroundMedia {
  type: BackgroundMediaType;
  element: HTMLImageElement | HTMLVideoElement;
  texture?: unknown;
  width: number;
  height: number;
  unload?: () => void;
}

/** Wires a video texture to playback (ticker/seek/subscription). Returns teardown. */
export type AttachVideo = (ctx: {
  app: PixiAppLike;
  video: HTMLVideoElement;
  render: () => void;
}) => Promise<() => void> | (() => void);

export interface PixiBackgroundDeps {
  loadPixi(): Promise<PixiModuleLike>;
  loadMedia(
    pixi: PixiModuleLike,
    src: string,
    mediaType: BackgroundMediaType,
  ): Promise<LoadedBackgroundMedia>;
  loadFilter(
    pixi: PixiModuleLike,
    effect: PixiBackgroundEffect,
    effectOptions: unknown,
  ): Promise<unknown>;
  /** Only invoked for video media; image backgrounds never touch this. */
  attachVideo?: AttachVideo;
  onError?(error: unknown): void;
}

export interface PixiBackgroundControllerOptions {
  host: HTMLElement;
  effect: PixiBackgroundEffect;
  effectOptions: unknown;
  pixelSize: number;
  preference: "webgl" | "webgpu";
  powerPreference: "high-performance" | "low-power";
  deps: PixiBackgroundDeps;
  /** Fired after each successful (non-stale) texture swap — lets the UI fade out the plain <img>. */
  onApplied?: () => void;
}

export interface PixiBackgroundController {
  /** Swap the background to `src`. A null src is a transient state — keep the current layer. */
  setSource(src: string | null, mediaType: BackgroundMediaType): Promise<void>;
  resize(): void;
  /** Rebuild the app and re-apply the last source after a GPU context/device loss. */
  recover(): Promise<void>;
  destroy(): void;
  readonly stats: { readonly appInits: number; readonly textureSwaps: number };
}

/** Bounded so a context-loss storm can't spin into an infinite rebuild loop. */
const MAX_RECOVER_ATTEMPTS = 2;

interface CurrentMedia {
  type: BackgroundMediaType;
  element: HTMLImageElement | HTMLVideoElement;
  width: number;
  height: number;
  unload?: () => void;
}

export function createPixiBackgroundController(
  options: PixiBackgroundControllerOptions,
): PixiBackgroundController {
  const { host, effect, effectOptions, pixelSize, preference, powerPreference, deps } = options;

  let destroyed = false;
  let pixi: PixiModuleLike | null = null;
  let app: PixiAppLike | null = null;
  let sprite: PixiSpriteLike | null = null;
  let filter: unknown = null;
  let resizeObserver: ResizeObserver | null = null;
  let currentMedia: CurrentMedia | null = null;
  let currentVideoTeardown: (() => void) | undefined;
  let appPromise: Promise<void> | null = null;
  let seq = 0;
  let lastSource: { src: string; mediaType: BackgroundMediaType } | null = null;
  let recoverAttempts = 0;
  const stats = { appInits: 0, textureSwaps: 0 };

  async function buildApp(): Promise<void> {
    const module = await deps.loadPixi();
    if (destroyed) return;
    pixi = module;
    const nextApp = new module.Application();
    await nextApp.init({
      antialias: false,
      autoDensity: false,
      // Static covers render on demand (resize/swap); the ticker only runs while
      // a video progresses. attachVideo starts/stops it with playback.
      autoStart: false,
      backgroundAlpha: 0,
      height: 1,
      width: 1,
      resolution: 1,
      preference,
      powerPreference,
    });
    if (destroyed) {
      nextApp.destroy({ removeView: true }, { children: true, context: true });
      return;
    }
    const view = nextApp.canvas;
    view.style.position = "absolute";
    view.style.inset = "0";
    view.style.width = "100%";
    view.style.height = "100%";
    view.style.imageRendering = effect === "pixel" ? "pixelated" : "auto";
    filter = await deps.loadFilter(module, effect, effectOptions);
    if (destroyed) {
      nextApp.destroy({ removeView: true }, { children: true, context: true });
      return;
    }
    app = nextApp;
    stats.appInits += 1;
    host.appendChild(view);
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(() => resize());
      resizeObserver.observe(host);
    }
    wireContextLossRecovery(nextApp, view);
  }

  /**
   * Best-practice GPU-loss recovery: WebGL fires `webglcontextlost` on the canvas
   * (preventDefault keeps it recoverable); WebGPU exposes a `device.lost` promise.
   * Either way we rebuild the app and re-apply the last source. The renderer shape
   * varies by Pixi backend/version, so the WebGPU probe is defensive. Real GPU loss
   * can't be exercised in jsdom — `recover()` itself is unit-tested directly.
   */
  function wireContextLossRecovery(builtApp: PixiAppLike, view: HTMLCanvasElement): void {
    view.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      void recover();
    });
    try {
      const renderer = builtApp.renderer as unknown as {
        device?: { lost?: Promise<{ reason?: string }> };
        gpu?: { device?: { lost?: Promise<{ reason?: string }> } };
      };
      const device = renderer?.device ?? renderer?.gpu?.device;
      void device?.lost?.then((info) => {
        if (!destroyed && info?.reason !== "destroyed") void recover();
      });
    } catch {
      // Renderer internals differ across Pixi backends/versions — skip if absent.
    }
  }

  function ensureApp(): Promise<void> {
    if (!appPromise) appPromise = buildApp();
    return appPromise;
  }

  function resize(): void {
    if (!app || !sprite || !currentMedia) return;
    const cssW = Math.max(1, Math.round(host.clientWidth || 1));
    const cssH = Math.max(1, Math.round(host.clientHeight || 1));
    const block = Math.max(3, Math.min(48, Math.round(pixelSize)));
    const dpr = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);
    const renderW =
      effect === "pixel" ? Math.max(1, Math.round(cssW / block)) : Math.round(cssW * dpr);
    const renderH =
      effect === "pixel" ? Math.max(1, Math.round(cssH / block)) : Math.round(cssH * dpr);
    app.renderer.resize(renderW, renderH);
    coverSprite(sprite, currentMedia.width, currentMedia.height, renderW, renderH);
    app.render();
  }

  function disposeMedia(media: CurrentMedia): void {
    if (media.type === "video") {
      const video = media.element as HTMLVideoElement;
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // Best-effort release; a partially-loaded WebView <video> can throw here.
      }
    }
    media.unload?.();
  }

  async function setSource(src: string | null, mediaType: BackgroundMediaType): Promise<void> {
    if (destroyed) return;
    // A null src is a transient "next blob URL still resolving" state during a
    // switch — keep the painted layer; the parent unmounts when truly empty.
    if (!src) return;
    const token = ++seq;
    try {
      await ensureApp();
    } catch (error) {
      deps.onError?.(error);
      return;
    }
    if (destroyed || !app || !pixi) return;

    let media: LoadedBackgroundMedia;
    try {
      media = await deps.loadMedia(pixi, src, mediaType);
    } catch (error) {
      deps.onError?.(error);
      return;
    }

    const texture =
      (media.texture as PixiTextureLike | undefined) ?? pixi.Texture.from(media.element, true);
    // A newer setSource won the race while this one was loading — discard.
    if (destroyed || token !== seq) {
      texture.destroy(true);
      disposeMedia({
        type: media.type,
        element: media.element,
        width: media.width,
        height: media.height,
        unload: media.unload,
      });
      return;
    }

    texture.source.scaleMode = "nearest";
    currentVideoTeardown?.();
    currentVideoTeardown = undefined;

    const previousTexture = sprite?.texture as PixiTextureLike | undefined;
    const previousMedia = currentMedia;

    if (!sprite) {
      sprite = new pixi.Sprite(texture);
      if (filter) sprite.filters = [filter];
      app.stage.addChild(sprite);
    } else {
      sprite.texture = texture;
    }

    currentMedia = {
      type: media.type,
      element: media.element,
      width: media.width,
      height: media.height,
      unload: media.unload,
    };

    if (media.type === "video" && deps.attachVideo) {
      const teardown = await deps.attachVideo({
        app,
        video: media.element as HTMLVideoElement,
        render: () => app?.render(),
      });
      if (destroyed || token !== seq) {
        teardown();
      } else {
        currentVideoTeardown = teardown;
      }
    }

    if (previousTexture && previousTexture !== texture) previousTexture.destroy(true);
    if (previousMedia) disposeMedia(previousMedia);

    lastSource = { src, mediaType };
    recoverAttempts = 0; // a fresh frame landed — allow recovery again
    stats.textureSwaps += 1;
    options.onApplied?.();
    resize();
  }

  async function recover(): Promise<void> {
    if (destroyed || recoverAttempts >= MAX_RECOVER_ATTEMPTS) return;
    recoverAttempts += 1;
    const source = lastSource;
    // The lost context took the textures with it — tear the app down and rebuild.
    currentVideoTeardown?.();
    currentVideoTeardown = undefined;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (currentMedia) {
      disposeMedia(currentMedia);
      currentMedia = null;
    }
    if (app) {
      try {
        app.destroy({ removeView: true }, { children: true, context: true });
      } catch {
        // The context may already be gone; ignore teardown errors during recovery.
      }
      app = null;
    }
    sprite = null;
    filter = null;
    pixi = null;
    appPromise = null;
    if (source) await setSource(source.src, source.mediaType);
  }

  function destroy(): void {
    destroyed = true;
    currentVideoTeardown?.();
    currentVideoTeardown = undefined;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (currentMedia) {
      disposeMedia(currentMedia);
      currentMedia = null;
    }
    if (app) {
      app.destroy(
        { removeView: true },
        { children: true, context: true, texture: true, textureSource: true },
      );
      app = null;
    }
    sprite = null;
  }

  return {
    setSource,
    resize,
    recover,
    destroy,
    get stats() {
      return stats;
    },
  };
}

function coverSprite(
  sprite: PixiSpriteLike,
  textureWidth: number,
  textureHeight: number,
  width: number,
  height: number,
): void {
  const sourceW = Math.max(1, textureWidth);
  const sourceH = Math.max(1, textureHeight);
  const scale = Math.max(width / sourceW, height / sourceH);
  const drawW = sourceW * scale;
  const drawH = sourceH * scale;
  sprite.scale.set(scale);
  sprite.position.set((width - drawW) / 2, (height - drawH) / 2);
}
