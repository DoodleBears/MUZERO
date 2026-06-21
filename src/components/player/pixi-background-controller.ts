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
import { createDiagnosticLogger } from "@/lib/logger";
import type { PixiBackgroundEffect } from "./pixi-pixel-background";

/**
 * Diagnostics for the switch-jank investigation: `appInit` should fire ONCE per
 * controller (re-init = a regression), `textureSwap` once per landed song with
 * its load+upload cost in ms. Visible in Settings → Trace / the perf HUD.
 */
const bgPixiLog = createDiagnosticLogger("background.pixi");

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface PixiTextureLike {
  source: { scaleMode: string };
  destroy(destroyBase?: boolean): void;
}

export interface PixiSpriteLike {
  texture: unknown;
  alpha: number;
  scale: { set(value: number): void };
  position: { set(x: number, y: number): void };
  destroy?(options?: unknown): void;
}

/**
 * Resident "adjustment layer" container: the background filter lives HERE, applied
 * ONCE to the composited result, while the cover sprites crossfade UNDERNEATH it
 * (added as its children, themselves unfiltered). So a cover→cover dissolve only
 * fades the image; the noise/pixel/etc. effect stays constant on top and never
 * crossfades. (Previously the filter was per-sprite, so two filtered layers blended
 * during a crossfade and the effect itself appeared to dissolve.)
 */
export interface PixiContainerLike {
  filters: unknown[];
  addChild(child: unknown): void;
  removeChild(child: unknown): void;
  destroy?(options?: unknown): void;
}

export interface PixiAppLike {
  init(options: Record<string, unknown>): Promise<void>;
  canvas: HTMLCanvasElement;
  stage: { addChild(child: unknown): void; removeChild(child: unknown): void };
  renderer: { resize(width: number, height: number): void };
  ticker: { start(): void; stop(): void; started: boolean };
  render(): void;
  destroy(removeView: unknown, options: unknown): void;
}

export interface PixiModuleLike {
  Application: new () => PixiAppLike;
  Container: new () => PixiContainerLike;
  Sprite: new (texture: unknown) => PixiSpriteLike;
  Texture: { from(source: unknown, skipCache?: boolean): PixiTextureLike };
}

export type BackgroundMediaType = "image" | "video";

export interface LoadedBackgroundMedia {
  type: BackgroundMediaType;
  // ImageBitmap is a first-class Pixi ImageSource — uploading it skips the
  // "Image element passed, converting to canvas" main-thread copy an
  // HTMLImageElement would trigger (PRD Phase 4). `unload` closes it.
  element: HTMLImageElement | HTMLVideoElement | ImageBitmap;
  bytes?: number;
  loader?: "imageBitmap" | "imageElement" | "videoElement";
  resizeMaxDimension?: number;
  sourceHeight?: number;
  sourceWidth?: number;
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
    options: { signal: AbortSignal },
  ): Promise<LoadedBackgroundMedia>;
  loadFilter(
    pixi: PixiModuleLike,
    effect: PixiBackgroundEffect,
    effectOptions: unknown,
  ): Promise<unknown>;
  /** Only invoked for video media; image backgrounds never touch this. */
  attachVideo?: AttachVideo;
  onError?(error: unknown): void;
  /**
   * Schedule the next animation frame for the cover→cover crossfade tween. Injected so
   * the tween is deterministic under test; defaults to requestAnimationFrame. Returns a
   * cancel fn. Returning a no-op canceller (and never calling back) effectively disables
   * the tween → instant swap, which is what jsdom/no-rAF environments fall back to.
   */
  requestFrame?(callback: (nowMs: number) => void): () => void;
}

export interface PixiBackgroundControllerOptions {
  host: HTMLElement;
  effect: PixiBackgroundEffect;
  effectOptions: unknown;
  /**
   * Optional switch-settle gate before the expensive media fetch/decode starts.
   * The plain <img> reveal layer can follow the current cover immediately while
   * the Pixi effect waits briefly to avoid decoding covers that are superseded.
   */
  loadDelayMs?: number;
  pixelSize: number;
  preference: "webgl" | "webgpu";
  powerPreference: "high-performance" | "low-power";
  deps: PixiBackgroundDeps;
  /** Fired after each successful (non-stale) texture swap — lets the UI fade out the plain <img>. */
  onApplied?: () => void;
  /**
   * Cover→cover crossfade duration (ms). The incoming cover is a second sprite under the
   * SAME resident filter that fades 0→1 over the old one (then the old is disposed), so
   * the effect is preserved throughout and covers dissolve instead of popping. 0 = instant
   * swap (no second sprite). Default 0 so existing callers/tests keep the swap semantics.
   */
  crossfadeMs?: number;
}

/** One cover in the lockstep window, keyed by its step offset from the centre. */
export interface WindowSlotSource {
  offsetSteps: number;
  src: string | null;
}

export interface PixiBackgroundController {
  /** Swap the background to `src`. A null src is a transient state — keep the current layer. */
  setSource(src: string | null, mediaType: BackgroundMediaType): Promise<void>;
  /** Mount the drag-follow overlay cover (image only; null tears it down). */
  setDragCover(src: string | null, mediaType: BackgroundMediaType): Promise<void>;
  /** Drive the drag overlay's opacity 0→1 as the finger moves (off the React path). */
  setDragProgress(progress: number): void;
  /** End the drag: freeze the overlay, then dispose it once the resting layer settles. */
  releaseDrag(): void;
  /**
   * Reconcile the lockstep cover-window sprite ring to `slots` (image-only). Sprites
   * are keyed by COVER SRC, so a cover that stays in the window keeps its sprite +
   * texture (only its offset changes) — a recenter never reassigns a visible sprite's
   * texture and only ONE sprite recycles (off-edge disposes, new edge loads). Never
   * rebuilds the app. Activates window mode (the single-sprite resting `setSource` is
   * suppressed until `clearWindow`). A null slot src is skipped (empty edge).
   */
  setWindow(slots: WindowSlotSource[]): Promise<void>;
  /** Per-frame drag offset (cover widths): re-runs the centred cross-fade so the cover
   *  being left fades out and the one arriving fades in. No horizontal translation. */
  setWindowOffset(steps: number): void;
  /** Leave window mode and dispose the ring (the resting `setSource` path resumes). */
  clearWindow(): void;
  resize(): void;
  /** Rebuild the app and re-apply the last source (or window) after a GPU loss. */
  recover(): Promise<void>;
  destroy(): void;
  readonly stats: { readonly appInits: number; readonly textureSwaps: number };
}

/** Bounded so a context-loss storm can't spin into an infinite rebuild loop. */
const MAX_RECOVER_ATTEMPTS = 2;

interface CurrentMedia {
  type: BackgroundMediaType;
  element: HTMLImageElement | HTMLVideoElement | ImageBitmap;
  width: number;
  height: number;
  unload?: () => void;
}

export function createPixiBackgroundController(
  options: PixiBackgroundControllerOptions,
): PixiBackgroundController {
  const {
    host,
    effect,
    effectOptions,
    loadDelayMs = 0,
    pixelSize,
    preference,
    powerPreference,
    deps,
  } = options;

  const crossfadeMs = options.crossfadeMs ?? 0;
  const requestFrame = deps.requestFrame ?? defaultRequestFrame;

  let destroyed = false;
  let pixi: PixiModuleLike | null = null;
  let app: PixiAppLike | null = null;
  // Resident filtered container; cover sprites are its children (see PixiContainerLike).
  let layerRoot: PixiContainerLike | null = null;
  let sprite: PixiSpriteLike | null = null;
  let filter: unknown = null;
  let resizeObserver: ResizeObserver | null = null;
  // Cached host CSS size. `renderSize()` runs per-frame during a drag/slide (via
  // applyWindowLayout); reading `host.clientWidth/clientHeight` there forces a layout
  // reflow EVERY frame — it was the top build-independent cost in the switch trace
  // (~34ms). The size only changes on a real resize, which the ResizeObserver already
  // routes through `resize()`, so cache it there and lazily on first use. (PRD
  // 20260617-dock-swipe-switch-jank #3.)
  let hostCssW = 0;
  let hostCssH = 0;
  let currentMedia: CurrentMedia | null = null;
  let currentVideoTeardown: (() => void) | undefined;
  let appPromise: Promise<void> | null = null;
  let pendingLoadAbort: AbortController | null = null;
  let seq = 0;
  let lastSource: { src: string; mediaType: BackgroundMediaType } | null = null;
  let recoverAttempts = 0;
  const stats = { appInits: 0, textureSwaps: 0 };

  // Cover→cover crossfade (crossfadeMs > 0): the OUTGOING sprite stays at alpha 1 while a
  // new sprite (same resident filter) fades 0→1 over it, then the outgoing is disposed.
  // At most one crossfade in flight — a newer switch finalizes the previous one first.
  let prevSprite: PixiSpriteLike | null = null;
  let prevMedia: CurrentMedia | null = null;
  let cancelCrossfade: (() => void) | null = null;

  // Drag-follow overlay: a TOP sprite inside the resident container showing the
  // incoming cover, its alpha driven straight off the drag progress (not a timer).
  // So while you drag, the image dissolves toward the neighbour under the resident
  // filter — at 100% drag it's already the incoming cover, so releasing changes
  // nothing. On commit it stays opaque on top, hiding the resting layer's own swap,
  // then is disposed once that has settled on the same cover (no flash). One only.
  let dragSprite: PixiSpriteLike | null = null;
  let dragMedia: CurrentMedia | null = null;
  let dragSrc: string | null = null;
  let dragAlpha = 0;
  let dragReleased = false;
  let dragAwaitingSettle = false;
  let dragLoadSeq = 0;
  let dragDisposeTimer: ReturnType<typeof setTimeout> | null = null;

  // Cover-window mode (lockstep with the foreground coverflow): a small RING of
  // sprites keyed by COVER SRC — NOT by offset. The sprite that holds a given cover
  // KEEPS holding it across a recenter (its offset/alpha change, its texture never
  // does), so a continuous drag never reassigns a visible sprite's texture = no
  // per-crossing flicker. On a recenter only ONE sprite recycles: the cover scrolled
  // off the far edge disposes, the new near-edge cover loads. Each sprite's alpha is
  // a continuous fn of its screen position (the cover being left fades out, the one
  // arriving fades in), so the cross-fade is seamless. `appInits` stays 1 (we never
  // rebuild the app). While active the single-sprite resting `setSource` is suppressed
  // (the window owns the visible covers); video / streamed covers never enter window
  // mode (the caller falls back to setSource), so this stays image-only.
  let windowActive = false;
  let windowOffsetSteps = 0;
  let lastWindowSlots: WindowSlotSource[] | null = null;
  let windowLoadSeq = 0;
  const windowSprites = new Map<string, PixiSpriteLike>();
  const windowMedia = new Map<string, CurrentMedia>();
  const windowSrcOffset = new Map<string, number>();

  function disposeSprite(target: PixiSpriteLike | null): void {
    if (!target) return;
    layerRoot?.removeChild(target);
    (target.texture as PixiTextureLike | undefined)?.destroy?.(true);
    target.destroy?.({ children: false, texture: false });
  }

  // Snap any in-flight crossfade to its end: incoming fully shown, outgoing disposed.
  function finalizeCrossfade(): void {
    if (cancelCrossfade) {
      cancelCrossfade();
      cancelCrossfade = null;
    }
    if (sprite) sprite.alpha = 1;
    if (prevSprite) {
      disposeSprite(prevSprite);
      prevSprite = null;
    }
    if (prevMedia) {
      disposeMedia(prevMedia);
      prevMedia = null;
    }
  }

  // Fade `incoming` 0→1 over `crossfadeMs`, rendering each frame; the outgoing sprite
  // (prevSprite, alpha 1) stays under it, then is disposed on completion. Frame-rate
  // independent via the injected scheduler's timestamp.
  function startCrossfade(incoming: PixiSpriteLike): void {
    let start = -1;
    const tick = (t: number) => {
      cancelCrossfade = null;
      if (destroyed || sprite !== incoming) {
        finalizeCrossfade();
        return;
      }
      if (start < 0) start = t;
      const p = crossfadeMs > 0 ? Math.min(1, (t - start) / crossfadeMs) : 1;
      incoming.alpha = p * p * (3 - 2 * p); // smoothstep
      app?.render();
      if (p >= 1) {
        finalizeCrossfade();
        // The resting layer has settled on the new cover; a released drag overlay
        // (held opaque on top, hiding this very swap) can now be removed seamlessly.
        if (dragAwaitingSettle) disposeDragSprite();
        return;
      }
      cancelCrossfade = requestFrame(tick);
    };
    cancelCrossfade = requestFrame(tick);
  }

  function disposeDragSprite(): void {
    if (dragDisposeTimer) {
      clearTimeout(dragDisposeTimer);
      dragDisposeTimer = null;
    }
    if (dragSprite) {
      disposeSprite(dragSprite);
      dragSprite = null;
    }
    if (dragMedia) {
      disposeMedia(dragMedia);
      dragMedia = null;
    }
    dragSrc = null;
    dragAlpha = 0;
    dragReleased = false;
    dragAwaitingSettle = false;
    dragLoadSeq += 1; // invalidate any in-flight drag load
  }

  // Load `src` as the drag overlay sprite (topmost child of the filtered container).
  // Image-only; a null src tears the overlay down. The caller then drives the alpha
  // via setDragProgress as the finger moves.
  async function setDragCover(src: string | null, mediaType: BackgroundMediaType): Promise<void> {
    if (destroyed) return;
    if (!src || mediaType !== "image") {
      disposeDragSprite();
      return;
    }
    if (src === dragSrc) return; // already loading/loaded this cover
    disposeDragSprite();
    dragSrc = src;
    dragReleased = false;
    const token = ++dragLoadSeq;
    try {
      await ensureApp();
    } catch {
      return;
    }
    if (destroyed || token !== dragLoadSeq || !app || !pixi || !layerRoot) return;
    let media: LoadedBackgroundMedia;
    try {
      media = await deps.loadMedia(pixi, src, "image", { signal: new AbortController().signal });
    } catch {
      return;
    }
    if (destroyed || token !== dragLoadSeq || !app || !pixi || !layerRoot) {
      media.unload?.();
      return;
    }
    const texture =
      (media.texture as PixiTextureLike | undefined) ?? pixi.Texture.from(media.element, true);
    texture.source.scaleMode = "nearest";
    const overlay = new pixi.Sprite(texture);
    overlay.alpha = dragAlpha;
    layerRoot.addChild(overlay); // topmost → over the resting cover sprites
    dragSprite = overlay;
    dragMedia = {
      type: "image",
      element: media.element,
      width: media.width,
      height: media.height,
      unload: media.unload,
    };
    coverSpriteToHost(overlay, dragMedia);
    app.render();
  }

  function setDragProgress(progress: number): void {
    if (dragReleased) return; // after release the overlay holds its endpoint
    dragAlpha = Math.max(0, Math.min(1, progress));
    if (dragSprite) {
      dragSprite.alpha = dragAlpha;
      app?.render();
    }
  }

  // Drag gesture ended. We FREEZE the overlay at whatever alpha the drag reached —
  // ~1 if it was dragged to a full commit (the overlay now shows the incoming cover
  // and hides the resting layer swapping to the SAME cover underneath), ~0 if it
  // snapped back (invisible). So we don't need to know commit vs snap-back. The
  // overlay is disposed once the resting layer settles on its new cover (the resting
  // crossfade completing, see startCrossfade) — or a generous fallback if that swap
  // never comes (snap-back: nothing settles, so the timer clears the invisible overlay).
  function releaseDrag(): void {
    dragReleased = true; // ignore the post-release transitionProgress reset to 0
    if (!dragSprite) {
      dragSrc = null;
      dragAwaitingSettle = false;
      return;
    }
    dragAwaitingSettle = true;
    if (dragDisposeTimer) clearTimeout(dragDisposeTimer);
    dragDisposeTimer = setTimeout(() => {
      dragDisposeTimer = null;
      disposeDragSprite();
    }, crossfadeMs + 400);
  }

  // Position a sprite to cover the current render size for its media dimensions.
  function coverSpriteToHost(target: PixiSpriteLike, media: CurrentMedia): void {
    if (!app) return;
    if (!hostCssW) refreshHostSize();
    const cssW = hostCssW;
    const cssH = hostCssH;
    const block = Math.max(3, Math.min(48, Math.round(pixelSize)));
    const dpr = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);
    const renderW =
      effect === "pixel" ? Math.max(1, Math.round(cssW / block)) : Math.round(cssW * dpr);
    const renderH =
      effect === "pixel" ? Math.max(1, Math.round(cssH / block)) : Math.round(cssH * dpr);
    coverSprite(target, media.width, media.height, renderW, renderH);
  }

  // ---- Lockstep cover window (foreground coverflow's background twin) -------------

  // Re-read the host CSS box (the only layout-reflow read). Called from `resize()`
  // (which the ResizeObserver drives) + lazily on first use — NOT per frame.
  function refreshHostSize(): void {
    hostCssW = Math.max(1, Math.round(host.clientWidth || 1));
    hostCssH = Math.max(1, Math.round(host.clientHeight || 1));
  }

  function renderSize(): { renderW: number; renderH: number } {
    if (!hostCssW) refreshHostSize();
    const cssW = hostCssW;
    const cssH = hostCssH;
    const block = Math.max(3, Math.min(48, Math.round(pixelSize)));
    const dpr = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);
    const renderW =
      effect === "pixel" ? Math.max(1, Math.round(cssW / block)) : Math.round(cssW * dpr);
    const renderH =
      effect === "pixel" ? Math.max(1, Math.round(cssH / block)) : Math.round(cssH * dpr);
    return { renderW, renderH };
  }

  // The ambient background stays CENTRED — it CROSS-FADES between neighbour covers as
  // the drag offset changes; it does NOT slide horizontally (the coverflow motion is
  // the foreground's job). Each sprite's alpha is `1 - |screenX|` of its own cover:
  // the cover being left (screenX → ±1) fades to 0 while the one arriving (screenX → 0)
  // fades to 1. Because a sprite is bound to its COVER (not an offset), this ramp is
  // continuous across a recenter — the cover's screenX is the same value either side
  // of the relabel — so there's no jump / flicker at the crossing.
  function windowOpacity(screenXSteps: number): number {
    return Math.max(0, Math.min(1, 1 - Math.abs(screenXSteps)));
  }

  function centerWindowSprite(
    target: PixiSpriteLike,
    media: CurrentMedia,
    renderW: number,
    renderH: number,
  ): void {
    const sourceW = Math.max(1, media.width);
    const sourceH = Math.max(1, media.height);
    const scale = Math.max(renderW / sourceW, renderH / sourceH);
    const drawW = sourceW * scale;
    const drawH = sourceH * scale;
    target.scale.set(scale);
    target.position.set((renderW - drawW) / 2, (renderH - drawH) / 2);
  }

  function applyWindowLayout(): void {
    if (!app) return;
    const { renderW, renderH } = renderSize();
    for (const [src, sprite] of windowSprites) {
      const media = windowMedia.get(src);
      const offset = windowSrcOffset.get(src);
      if (!media || offset === undefined) {
        sprite.alpha = 0;
        continue;
      }
      centerWindowSprite(sprite, media, renderW, renderH);
      sprite.alpha = windowOpacity(offset + windowOffsetSteps);
    }
    app.render();
  }

  // Stack the window sprites by SIGNED offset — smaller offset on top (−2 topmost …
  // +2 bottommost). With the centred cross-fade this makes the dissolve correct in
  // BOTH directions: dragging next, the centre (0) sits above the incoming (+1) and
  // fades out to reveal it; dragging prev, the incoming (−1) sits above (0) and fades
  // in. (Pixi z = child order, so we re-add from highest offset to lowest.) Only the
  // window sprites move; the resting sprite stays underneath them all.
  function restackWindow(): void {
    if (!layerRoot) return;
    const ordered = [...windowSrcOffset.entries()]
      .filter(([src]) => windowSprites.has(src))
      .sort((a, b) => b[1] - a[1]);
    for (const [src] of ordered) {
      const s = windowSprites.get(src);
      if (s) layerRoot.addChild(s); // re-append → lowest offset ends up topmost
    }
  }

  // Dispose the sprite + media for a cover that recycled off the window edge.
  function disposeWindowSrc(src: string): void {
    const sprite = windowSprites.get(src);
    if (sprite) {
      layerRoot?.removeChild(sprite);
      (sprite.texture as PixiTextureLike | undefined)?.destroy?.(true);
      sprite.destroy?.({ children: false, texture: false });
    }
    const media = windowMedia.get(src);
    if (media) disposeMedia(media);
    windowSprites.delete(src);
    windowMedia.delete(src);
    windowSrcOffset.delete(src);
  }

  // Load a cover into a NEW window sprite (the recycled edge). The offset is reserved
  // synchronously so a recenter mid-load knows the cover is wanted; if it's dropped
  // before the load lands, the media is released.
  async function loadWindowSrc(src: string, offset: number, token: number): Promise<void> {
    if (windowSprites.has(src)) {
      windowSrcOffset.set(src, offset);
      return;
    }
    windowSrcOffset.set(src, offset);
    try {
      await ensureApp();
    } catch {
      return;
    }
    if (destroyed || token !== windowLoadSeq || !app || !pixi || !layerRoot) return;
    if (windowSprites.has(src)) return; // a concurrent load won the race
    if (!windowSrcOffset.has(src)) return; // dropped before we started loading
    let media: LoadedBackgroundMedia;
    try {
      media = await deps.loadMedia(pixi, src, "image", { signal: new AbortController().signal });
    } catch {
      return;
    }
    if (destroyed || token !== windowLoadSeq || !pixi || !layerRoot || !windowSrcOffset.has(src)) {
      media.unload?.();
      return;
    }
    const texture =
      (media.texture as PixiTextureLike | undefined) ?? pixi.Texture.from(media.element, true);
    texture.source.scaleMode = "nearest";
    const sprite = new pixi.Sprite(texture);
    sprite.alpha = 0;
    layerRoot.addChild(sprite);
    windowSprites.set(src, sprite);
    windowMedia.set(src, {
      type: "image",
      element: media.element,
      width: media.width,
      height: media.height,
      unload: media.unload,
    });
    restackWindow();
    applyWindowLayout();
  }

  async function setWindow(slots: WindowSlotSource[]): Promise<void> {
    if (destroyed) return;
    windowActive = true;
    lastWindowSlots = slots;
    const token = ++windowLoadSeq;
    // src → nearest offset (a short looping queue can repeat a cover; the occurrence
    // closest to centre owns the sprite — the far repeats are alpha-0 anyway).
    const desired = new Map<string, number>();
    for (const slot of slots) {
      if (!slot.src) continue;
      const existing = desired.get(slot.src);
      if (existing === undefined || Math.abs(slot.offsetSteps) < Math.abs(existing)) {
        desired.set(slot.src, slot.offsetSteps);
      }
    }
    // Recycle covers that scrolled off the window edge.
    for (const src of [...windowSprites.keys()]) {
      if (!desired.has(src)) disposeWindowSrc(src);
    }
    for (const src of [...windowSrcOffset.keys()]) {
      if (!desired.has(src)) windowSrcOffset.delete(src);
    }
    // Retarget the offsets of EXISTING sprites + relayout SYNCHRONOUSLY (before the
    // async app/edge-cover load). A recentre publishes the new window AND resets the
    // shared offset in the same React layout phase; the offset reset fires our
    // `applyOffset` synchronously, so the sprite offsets must already be the new ones
    // by then — otherwise that frame paints the OLD centre cover at centre (the
    // reported "背景闪一下、像切回上一张封面"). Recentred neighbours are already loaded,
    // so this is a pure offset retarget; only genuinely NEW edge covers load below.
    let hasNewSrc = false;
    for (const [src, offset] of desired) {
      if (windowSprites.has(src)) windowSrcOffset.set(src, offset);
      else hasNewSrc = true;
    }
    if (app) {
      restackWindow();
      applyWindowLayout();
    }
    if (!hasNewSrc) return;
    try {
      await ensureApp();
    } catch (error) {
      deps.onError?.(error);
      return;
    }
    if (destroyed || token !== windowLoadSeq || !app || !pixi || !layerRoot) return;
    for (const [src, offset] of desired) {
      if (!windowSprites.has(src)) void loadWindowSrc(src, offset, token);
    }
    restackWindow();
    applyWindowLayout();
  }

  function setWindowOffset(steps: number): void {
    windowOffsetSteps = steps;
    applyWindowLayout();
  }

  function clearWindow(): void {
    const wasActive = windowActive;
    windowActive = false;
    windowOffsetSteps = 0;
    lastWindowSlots = null;
    windowLoadSeq += 1;
    // Hand the CENTRED window cover off to the resting sprite BEFORE disposing the
    // window. The resting sprite still holds the PRE-drag cover (its `setSource` was
    // gated while the window owned the covers); disposing the window without this
    // would reveal that stale cover for a frame until `setSource` reloads — the
    // reported "commit 后闪回上一张". Transferring the centre texture makes the resting
    // layer already show the committed cover, so the hand-off is seamless.
    const centreEntry = [...windowSrcOffset.entries()].find(([, o]) => o === 0);
    const centreSrc = centreEntry?.[0];
    const centreSprite = centreSrc ? windowSprites.get(centreSrc) : undefined;
    const centreMedia = centreSrc ? windowMedia.get(centreSrc) : undefined;
    if (wasActive && centreSrc && centreSprite && centreMedia && pixi && layerRoot) {
      const centreTexture = centreSprite.texture as PixiTextureLike;
      if (sprite) {
        const oldTexture = sprite.texture as PixiTextureLike | undefined;
        sprite.texture = centreTexture;
        sprite.alpha = 1;
        if (oldTexture && oldTexture !== centreTexture) oldTexture.destroy(true);
      } else {
        sprite = new pixi.Sprite(centreTexture);
        sprite.alpha = 1;
        layerRoot.addChild(sprite);
      }
      if (currentMedia) disposeMedia(currentMedia);
      currentMedia = centreMedia;
      // The centre sprite's texture + media now belong to the resting sprite —
      // detach the window sprite WITHOUT destroying them.
      layerRoot.removeChild(centreSprite);
      centreSprite.destroy?.({ children: false, texture: false });
      windowSprites.delete(centreSrc);
      windowMedia.delete(centreSrc);
      windowSrcOffset.delete(centreSrc);
      resize(); // re-cover the resting sprite for the adopted media's dimensions
    }
    for (const src of [...windowSprites.keys()]) disposeWindowSrc(src);
    windowSrcOffset.clear();
    app?.render();
    // Refresh the resting layer to the committed cover's OWN background source (the
    // adopted coverflow texture bridges the gap; this swaps to the proper bg cover —
    // the same image, so it's invisible). For a coverless centre this is the only
    // resume path.
    if (wasActive && !destroyed && lastSource) {
      void setSource(lastSource.src, lastSource.mediaType);
    }
  }

  async function buildApp(): Promise<void> {
    const startedAt = nowMs();
    const module = await deps.loadPixi();
    if (destroyed) return;
    pixi = module;
    const nextApp = new module.Application();
    try {
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
        teardownApp(nextApp, { full: false });
        return;
      }
      const view = nextApp.canvas;
      view.style.position = "absolute";
      view.style.inset = "0";
      view.style.width = "100%";
      view.style.height = "100%";
      view.style.imageRendering = effect === "pixel" ? "pixelated" : "auto";
      // Keep the canvas BELOW the plain <img> reveal layer so a freshly-swapped
      // texture is uncovered by fading the img out, not popped in (PRD Phase 2 / #3).
      view.style.zIndex = "0";
      filter = await deps.loadFilter(module, effect, effectOptions);
      if (destroyed) {
        teardownApp(nextApp, { full: false });
        return;
      }
      app = nextApp;
      // The resident "adjustment layer": filter applied ONCE here, cover sprites
      // crossfade as its (unfiltered) children, so the effect never dissolves.
      const root = new module.Container();
      root.filters = filter ? [filter] : [];
      nextApp.stage.addChild(root);
      layerRoot = root;
      stats.appInits += 1;
      host.appendChild(view);
      if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(() => resize());
        resizeObserver.observe(host);
      }
      wireContextLossRecovery(nextApp, view);
      bgPixiLog.debug("appInit", {
        backend: preference,
        power: powerPreference,
        effect,
        ms: Math.round(nowMs() - startedAt),
      });
    } catch (error) {
      // init()/loadFilter() failed (most often a WebGPU `requestDevice` OOM once the
      // GPU is already exhausted): release the half-built app + its GPU device so a
      // FAILED attempt doesn't itself leak a device and deepen the hole. `app` isn't
      // assigned until after both awaits, so clear it only if we got that far.
      if (app === nextApp) app = null;
      teardownApp(nextApp, { full: false });
      throw error;
    }
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

  function resize(): number {
    // The resize event IS the time to re-read the host box (drives the cache that
    // per-frame `renderSize()` then reuses without reflow).
    refreshHostSize();
    // In pure window mode there is no resting `sprite`; still resize + relayout the
    // window ring.
    if (app && windowActive && (!sprite || !currentMedia)) {
      const { renderW, renderH } = renderSize();
      app.renderer.resize(renderW, renderH);
      applyWindowLayout();
      return 0;
    }
    if (!app || !sprite || !currentMedia) return 0;
    const startedAt = nowMs();
    const cssW = hostCssW;
    const cssH = hostCssH;
    const block = Math.max(3, Math.min(48, Math.round(pixelSize)));
    const dpr = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);
    const renderW =
      effect === "pixel" ? Math.max(1, Math.round(cssW / block)) : Math.round(cssW * dpr);
    const renderH =
      effect === "pixel" ? Math.max(1, Math.round(cssH / block)) : Math.round(cssH * dpr);
    app.renderer.resize(renderW, renderH);
    coverSprite(sprite, currentMedia.width, currentMedia.height, renderW, renderH);
    if (windowActive) applyWindowLayout();
    // Keep the outgoing crossfade sprite covered too, so a resize mid-fade doesn't skew it.
    if (prevSprite && prevMedia) {
      coverSprite(prevSprite, prevMedia.width, prevMedia.height, renderW, renderH);
    }
    if (dragSprite && dragMedia) {
      coverSprite(dragSprite, dragMedia.width, dragMedia.height, renderW, renderH);
    }
    app.render();
    return nowMs() - startedAt;
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
    // While the lockstep window owns the visible covers, the single resting sprite
    // must not re-point — a mid-drag store commit re-pointing it was the old "闪黑".
    // Keep `lastSource` current so recover() / clearWindow() can restore the resting
    // layer afterwards, but don't run the swap.
    if (windowActive) {
      if (src) lastSource = { src, mediaType };
      return;
    }
    pendingLoadAbort?.abort();
    pendingLoadAbort = null;
    const token = ++seq;
    // A null src is a transient "next blob URL still resolving" state during a
    // switch — keep the painted layer but invalidate any in-flight load.
    if (!src) return;
    const loadAbort = new AbortController();
    pendingLoadAbort = loadAbort;
    const sourceKind = classifyBackgroundSource(src);
    const swapStart = nowMs();
    bgPixiLog.debug("textureSwap.start", {
      category: "performance",
      phase: "start",
      mediaType,
      sourceKind,
      swapSeq: token,
    });
    try {
      await ensureApp();
    } catch (error) {
      deps.onError?.(error);
      return;
    }
    if (destroyed || token !== seq || loadAbort.signal.aborted || !app || !pixi) return;

    const mediaLoadStart = nowMs();
    let media: LoadedBackgroundMedia;
    try {
      await delayOrAbort(loadDelayMs, loadAbort.signal);
      media = await deps.loadMedia(pixi, src, mediaType, { signal: loadAbort.signal });
    } catch (error) {
      const aborted = loadAbort.signal.aborted || isAbortError(error);
      if (pendingLoadAbort === loadAbort) pendingLoadAbort = null;
      bgPixiLog[aborted ? "debug" : "warn"]("media.load", {
        category: "performance",
        phase: aborted ? "skip" : "fail",
        errorKind: aborted ? undefined : "unknown",
        mediaType,
        reason: aborted ? "aborted" : undefined,
        sourceKind,
        swapSeq: token,
        durationMs: roundMs(nowMs() - mediaLoadStart),
      });
      if (!aborted) deps.onError?.(error);
      return;
    }
    if (pendingLoadAbort === loadAbort) pendingLoadAbort = null;
    const loadMs = nowMs() - mediaLoadStart;
    const mediaContext = {
      bytes: media.bytes,
      category: "performance" as const,
      height: media.height,
      loader: media.loader,
      mediaType,
      phase: "success" as const,
      resizeMaxDimension: media.resizeMaxDimension,
      sourceKind,
      sourceHeight: media.sourceHeight,
      sourceWidth: media.sourceWidth,
      swapSeq: token,
      width: media.width,
    };
    bgPixiLog.debug("media.load", {
      ...mediaContext,
      durationMs: roundMs(loadMs),
    });

    const textureStart = nowMs();
    const textureSource = media.texture ? "prebuilt" : "fromElement";
    const texture =
      (media.texture as PixiTextureLike | undefined) ?? pixi.Texture.from(media.element, true);
    const textureMs = nowMs() - textureStart;
    bgPixiLog.debug("texture.create", {
      ...mediaContext,
      durationMs: roundMs(textureMs),
      textureSource,
    });
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
      bgPixiLog.debug("textureSwap.stale", {
        ...mediaContext,
        phase: "skip",
        durationMs: roundMs(nowMs() - swapStart),
        loadMs: roundMs(loadMs),
        textureMs: roundMs(textureMs),
      });
      return;
    }

    const applyStart = nowMs();
    texture.source.scaleMode = "nearest";

    // A new swap supersedes any in-flight crossfade: finalize it first so `sprite` is the
    // settled current cover before we (maybe) start a fresh crossfade from it.
    finalizeCrossfade();
    currentVideoTeardown?.();
    currentVideoTeardown = undefined;

    const previousSprite = sprite;
    const previousTexture = previousSprite?.texture as PixiTextureLike | undefined;
    const previousMedia = currentMedia;
    // Crossfade only image→image: video swaps (in or out) stay instant.
    const willCrossfade =
      crossfadeMs > 0 &&
      !!previousSprite &&
      media.type === "image" &&
      previousMedia?.type === "image";

    if (!previousSprite) {
      sprite = new pixi.Sprite(texture);
      sprite.alpha = 1;
      layerRoot?.addChild(sprite);
    } else if (willCrossfade) {
      // Keep the OUTGOING sprite (alpha 1) and fade a NEW one in over it INSIDE the
      // resident filtered container, so the effect stays constant and only the covers
      // dissolve. The sprites themselves carry no filter (the container does).
      const incoming = new pixi.Sprite(texture);
      incoming.alpha = 0;
      layerRoot?.addChild(incoming);
      sprite = incoming;
    } else {
      previousSprite.texture = texture; // instant swap (video / crossfade disabled)
      sprite = previousSprite;
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

    if (willCrossfade) {
      // Hold the outgoing sprite + its media; the tween disposes them on completion.
      prevSprite = previousSprite;
      prevMedia = previousMedia;
      startCrossfade(sprite);
    } else {
      if (previousTexture && previousTexture !== texture) previousTexture.destroy(true);
      if (previousMedia) disposeMedia(previousMedia);
    }

    lastSource = { src, mediaType };
    recoverAttempts = 0; // a fresh frame landed — allow recovery again
    stats.textureSwaps += 1;
    options.onApplied?.();
    const renderMs = resize();
    const applyMs = nowMs() - applyStart;
    bgPixiLog.debug("textureSwap.apply", {
      ...mediaContext,
      applyMs: roundMs(applyMs),
      durationMs: roundMs(applyMs),
      renderMs: roundMs(renderMs),
    });
    bgPixiLog.debug("textureSwap", {
      ...mediaContext,
      appInits: stats.appInits,
      applyMs: roundMs(applyMs),
      durationMs: roundMs(nowMs() - swapStart),
      loadMs: roundMs(loadMs),
      renderMs: roundMs(renderMs),
      textureMs: roundMs(textureMs),
      textureSwaps: stats.textureSwaps,
    });
  }

  async function recover(): Promise<void> {
    if (destroyed || recoverAttempts >= MAX_RECOVER_ATTEMPTS) return;
    pendingLoadAbort?.abort();
    pendingLoadAbort = null;
    recoverAttempts += 1;
    bgPixiLog.warn("recover", { attempt: recoverAttempts, backend: preference });
    const source = lastSource;
    // Snapshot the window so it can be rebuilt after the context is restored.
    const windowSlots = windowActive ? lastWindowSlots : null;
    // The lost context took the textures with it — tear the app down and rebuild.
    currentVideoTeardown?.();
    currentVideoTeardown = undefined;
    if (cancelCrossfade) {
      cancelCrossfade();
      cancelCrossfade = null;
    }
    disposeDragSprite();
    // The lost context already invalidated the window textures/sprites; drop the
    // bookkeeping (don't destroy — the GPU objects are gone) so setWindow rebuilds.
    windowSprites.clear();
    windowMedia.clear();
    windowSrcOffset.clear();
    windowLoadSeq += 1;
    if (prevMedia) disposeMedia(prevMedia);
    prevSprite = null;
    prevMedia = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (currentMedia) {
      disposeMedia(currentMedia);
      currentMedia = null;
    }
    if (app) {
      // teardownApp swallows destroy errors (the context may already be gone) AND
      // explicitly releases the WebGPU device Pixi leaks — otherwise a GPU-loss
      // recovery storm rebuilds devices that never free, hastening the OOM it's
      // recovering from.
      teardownApp(app, { full: false });
      app = null;
    }
    layerRoot = null;
    sprite = null;
    filter = null;
    pixi = null;
    appPromise = null;
    if (windowSlots) {
      windowActive = false; // let setWindow re-arm it cleanly on the rebuilt app
      await setWindow(windowSlots);
      setWindowOffset(windowOffsetSteps);
    } else if (source) {
      await setSource(source.src, source.mediaType);
    }
  }

  function destroy(): void {
    destroyed = true;
    pendingLoadAbort?.abort();
    pendingLoadAbort = null;
    if (cancelCrossfade) {
      cancelCrossfade();
      cancelCrossfade = null;
    }
    disposeDragSprite();
    clearWindow();
    if (prevMedia) disposeMedia(prevMedia);
    prevSprite = null;
    prevMedia = null;
    currentVideoTeardown?.();
    currentVideoTeardown = undefined;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (currentMedia) {
      disposeMedia(currentMedia);
      currentMedia = null;
    }
    if (app) {
      teardownApp(app, { full: true });
      app = null;
    }
    layerRoot = null;
    sprite = null;
  }

  return {
    setSource,
    setDragCover,
    setDragProgress,
    releaseDrag,
    setWindow,
    setWindowOffset,
    clearWindow,
    resize,
    recover,
    destroy,
    get stats() {
      return stats;
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function delayOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal.aborted) return Promise.reject(createAbortError());
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Default crossfade frame scheduler: requestAnimationFrame when available, else a
 * setTimeout fallback driven by performance.now() so the tween still progresses (SSR /
 * jsdom without rAF). Tests inject a deterministic scheduler via deps.requestFrame.
 */
function defaultRequestFrame(callback: (nowMs: number) => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame((t) => callback(t));
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(() => callback(nowMs()), 16);
  return () => clearTimeout(id);
}

function createAbortError(): DOMException {
  return new DOMException("Background texture load aborted", "AbortError");
}

/**
 * Read the renderer's live WebGPU device BEFORE `app.destroy()` runs — destroy()
 * nulls `renderer.gpu`, so it's unreadable afterwards. WebGL renderers have no
 * `.gpu`, so this returns undefined there (no-op). Defensive across Pixi
 * backends/versions (the fake renderer in unit tests has neither field).
 */
function readGpuDevice(app: PixiAppLike): { destroy?: () => void } | undefined {
  try {
    const renderer = app.renderer as unknown as {
      gpu?: { device?: { destroy?: () => void } };
    };
    return renderer?.gpu?.device;
  } catch {
    return undefined;
  }
}

/**
 * Destroy a Pixi app AND explicitly release its WebGPU device.
 *
 * Pixi v8's `GpuDeviceSystem.destroy()` only NULLS its `GPUDevice` reference — it
 * never calls `device.destroy()`. So the underlying D3D12 device + command queue
 * outlive `app.destroy()` and leak until GC (which for `GPUDevice` is unreliable and
 * deferred). Across enough Now Playing background mount/unmount + GPU-loss-recovery
 * cycles the GPU runs out and the next `requestDevice()` fails with
 * "D3D12 create command queue failed with E_OUTOFMEMORY". The WebGL path has no leak
 * (`GlContextSystem.destroy()` calls `loseContext()`), so this only bites WebGPU —
 * which is the auto-selected backend on Electron/Chromium. We grab the device first,
 * let Pixi tear its objects down, then destroy the device ourselves.
 */
function teardownApp(target: PixiAppLike, options: { full: boolean }): void {
  const device = readGpuDevice(target);
  try {
    target.destroy(
      { removeView: true },
      options.full
        ? { children: true, context: true, texture: true, textureSource: true }
        : { children: true, context: true },
    );
  } catch {
    // The GPU context may already be gone (recovery path); ignore teardown errors.
  }
  try {
    // Destroying an already-lost device is a no-op; `device.lost` then resolves with
    // reason "destroyed", which wireContextLossRecovery deliberately ignores (no
    // recovery loop). On WebGL `device` is undefined and this does nothing.
    device?.destroy?.();
  } catch {
    // Some backends throw if the device is mid-teardown; the leak is already closed.
  }
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

function classifyBackgroundSource(src: string): "blob" | "data" | "http" | "muzfetch" | "other" {
  try {
    const protocol = new URL(src).protocol.toLowerCase();
    if (protocol === "blob:") return "blob";
    if (protocol === "data:") return "data";
    if (protocol === "http:" || protocol === "https:") return "http";
    if (protocol === "muzfetch:") return "muzfetch";
  } catch {
    // Non-URL renderer-internal source; keep it coarse and non-identifying.
  }
  return "other";
}
