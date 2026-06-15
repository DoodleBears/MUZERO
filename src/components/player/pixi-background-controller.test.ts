import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTrace, getTraceEntries } from "@/lib/trace";
import {
  createPixiBackgroundController,
  type LoadedBackgroundMedia,
  type PixiModuleLike,
} from "./pixi-background-controller";

function fakeTexture() {
  return { source: { scaleMode: "linear" }, destroy: vi.fn() };
}

function fakeApp() {
  return {
    initCalls: [] as unknown[],
    init(opts: unknown) {
      this.initCalls.push(opts);
      return Promise.resolve();
    },
    canvas: document.createElement("canvas"),
    stage: { addChild: vi.fn(), removeChild: vi.fn() },
    renderer: { resize: vi.fn() },
    ticker: {
      started: false,
      start() {
        this.started = true;
      },
      stop() {
        this.started = false;
      },
    },
    render: vi.fn(),
    destroy: vi.fn(),
  };
}

type FakeApp = ReturnType<typeof fakeApp>;

function fakeModule() {
  const apps: FakeApp[] = [];
  const module = {
    apps,
    Application: function Application(this: unknown) {
      const a = fakeApp();
      apps.push(a);
      return a as never;
    },
    Sprite: function Sprite(this: unknown, texture: unknown) {
      return {
        texture,
        filters: [] as unknown[],
        alpha: 1,
        scale: { set: vi.fn() },
        position: { set: vi.fn() },
        destroy: vi.fn(),
      } as never;
    },
    Texture: { from: () => fakeTexture() },
  };
  return module as unknown as PixiModuleLike & { apps: FakeApp[] };
}

function makeController(overrides?: {
  loadDelayMs?: number;
  preference?: "webgl" | "webgpu";
  powerPreference?: "high-performance" | "low-power";
  loadMedia?: (src: string, signal: AbortSignal) => Promise<LoadedBackgroundMedia>;
}) {
  const module = fakeModule();
  const textures: ReturnType<typeof fakeTexture>[] = [];
  const loadMedia =
    overrides?.loadMedia ??
    (async (_src: string): Promise<LoadedBackgroundMedia> => {
      const texture = fakeTexture();
      textures.push(texture);
      return {
        type: "image",
        element: document.createElement("img"),
        texture: texture as never,
        width: 100,
        height: 100,
        unload: vi.fn(),
      };
    });
  const host = document.createElement("div");
  const onError = vi.fn();
  const controller = createPixiBackgroundController({
    host,
    effect: "noise",
    effectOptions: {} as never,
    pixelSize: 12,
    preference: overrides?.preference ?? "webgl",
    powerPreference: overrides?.powerPreference ?? "low-power",
    loadDelayMs: overrides?.loadDelayMs,
    deps: {
      loadPixi: async () => module,
      loadMedia: async (_pixi, src, _mediaType, { signal }) => loadMedia(src, signal),
      loadFilter: async () => null,
      onError,
    },
  });
  return { module, textures, host, controller, onError };
}

describe("createPixiBackgroundController", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearTrace();
  });

  it("creates and inits the Pixi app exactly once across multiple source swaps", async () => {
    const { module, controller } = makeController();
    await controller.setSource("a.png", "image");
    await controller.setSource("b.png", "image");
    await controller.setSource("c.png", "image");
    expect(module.apps.length).toBe(1);
    expect(module.apps[0].initCalls.length).toBe(1);
    expect(controller.stats.appInits).toBe(1);
    expect(controller.stats.textureSwaps).toBe(3);
    controller.destroy();
  });

  it("feeds the resolved gpu backend + power preference to app.init", async () => {
    const { module, controller } = makeController({
      preference: "webgpu",
      powerPreference: "high-performance",
    });
    await controller.setSource("a.png", "image");
    expect(module.apps[0].initCalls[0]).toMatchObject({
      preference: "webgpu",
      powerPreference: "high-performance",
    });
    controller.destroy();
  });

  it("swaps the sprite texture and destroys the previous one (no app rebuild)", async () => {
    const { textures, controller } = makeController();
    await controller.setSource("a.png", "image");
    const first = textures[0];
    await controller.setSource("b.png", "image");
    expect(first.destroy).toHaveBeenCalled();
    controller.destroy();
  });

  it("keeps the current layer on a null (transient) source", async () => {
    const { module, controller } = makeController();
    await controller.setSource("a.png", "image");
    await controller.setSource(null, "image");
    expect(module.apps.length).toBe(1);
    expect(controller.stats.textureSwaps).toBe(1);
    controller.destroy();
  });

  it("destroys the app on destroy()", async () => {
    const { module, controller } = makeController();
    await controller.setSource("a.png", "image");
    controller.destroy();
    expect(module.apps[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("recover() rebuilds the app and re-applies the last source (device-lost path)", async () => {
    const { module, controller } = makeController();
    await controller.setSource("a.png", "image");
    expect(module.apps.length).toBe(1);
    await controller.recover();
    // A fresh app is built (the lost GPU context is gone) and the last source is
    // re-uploaded so the background reappears without a black frame.
    expect(module.apps.length).toBe(2);
    expect(controller.stats.appInits).toBe(2);
    expect(controller.stats.textureSwaps).toBe(2);
    expect(module.apps[0].destroy).toHaveBeenCalled();
    controller.destroy();
  });

  it("recover() is a no-op after destroy()", async () => {
    const { module, controller } = makeController();
    await controller.setSource("a.png", "image");
    controller.destroy();
    await controller.recover();
    expect(module.apps.length).toBe(1);
  });

  it("uploads an ImageBitmap source directly (no canvas conversion) and closes it when swapped/destroyed", async () => {
    // Capture what gets handed to Texture.from — for the ImageBitmap path it must
    // be the bitmap itself, never an <img>/canvas (that's the conversion we're
    // killing). A bare fakeModule discards from() args, so build one that records.
    const fromArgs: unknown[] = [];
    const apps: FakeApp[] = [];
    const module = {
      Application: function Application(this: unknown) {
        const a = fakeApp();
        apps.push(a);
        return a as never;
      },
      Sprite: function Sprite(this: unknown, texture: unknown) {
        return {
          texture,
          filters: [] as unknown[],
          scale: { set: vi.fn() },
          position: { set: vi.fn() },
        } as never;
      },
      Texture: {
        from: (source: unknown) => {
          fromArgs.push(source);
          return fakeTexture();
        },
      },
    } as unknown as PixiModuleLike;

    const bitmapA = { width: 64, height: 48, close: vi.fn() };
    const bitmapB = { width: 64, height: 48, close: vi.fn() };
    const media: Record<string, LoadedBackgroundMedia> = {
      "a.png": {
        type: "image",
        element: bitmapA as unknown as ImageBitmap,
        width: 64,
        height: 48,
        unload: () => bitmapA.close(),
      },
      "b.png": {
        type: "image",
        element: bitmapB as unknown as ImageBitmap,
        width: 64,
        height: 48,
        unload: () => bitmapB.close(),
      },
    };
    const controller = createPixiBackgroundController({
      host: document.createElement("div"),
      effect: "noise",
      effectOptions: {} as never,
      pixelSize: 12,
      preference: "webgl",
      powerPreference: "low-power",
      deps: {
        loadPixi: async () => module,
        loadMedia: async (_pixi, src) => media[src],
        loadFilter: async () => null,
      },
    });

    await controller.setSource("a.png", "image");
    // The bitmap is uploaded as-is — no HTMLImageElement, no canvas conversion.
    expect(fromArgs[0]).toBe(bitmapA);

    await controller.setSource("b.png", "image");
    expect(bitmapA.close).toHaveBeenCalledTimes(1); // previous bitmap freed on swap
    expect(bitmapB.close).not.toHaveBeenCalled();

    controller.destroy();
    expect(bitmapB.close).toHaveBeenCalledTimes(1); // current bitmap freed on destroy
  });

  it("emits granular texture swap diagnostics for load, texture creation, apply, and render work", async () => {
    const { controller } = makeController({
      loadMedia: async (): Promise<LoadedBackgroundMedia> => ({
        type: "image",
        element: document.createElement("img"),
        width: 320,
        height: 180,
        loader: "imageBitmap",
        bytes: 123_456,
        resizeMaxDimension: 1024,
        sourceHeight: 1440,
        sourceWidth: 2560,
        unload: vi.fn(),
      }),
    });

    await controller.setSource("blob:cover", "image");

    const entries = getTraceEntries().filter((entry) => entry.scope === "background.pixi");
    expect(entries.map((entry) => entry.event)).toEqual(
      expect.arrayContaining([
        "textureSwap.start",
        "media.load",
        "texture.create",
        "textureSwap.apply",
        "textureSwap",
      ]),
    );
    const load = entries.find((entry) => entry.event === "media.load");
    expect(load?.context).toMatchObject({
      category: "performance",
      phase: "success",
      mediaType: "image",
      loader: "imageBitmap",
      bytes: 123_456,
      resizeMaxDimension: 1024,
      sourceHeight: 1440,
      sourceWidth: 2560,
      width: 320,
      height: 180,
    });
    const summary = entries.find((entry) => entry.event === "textureSwap");
    expect(summary?.context).toMatchObject({
      category: "performance",
      phase: "success",
      mediaType: "image",
      loader: "imageBitmap",
      bytes: 123_456,
      resizeMaxDimension: 1024,
      sourceHeight: 1440,
      sourceWidth: 2560,
      width: 320,
      height: 180,
      appInits: 1,
      textureSwaps: 1,
    });
    expect(summary?.context?.durationMs).toEqual(expect.any(Number));
    expect(summary?.context?.loadMs).toEqual(expect.any(Number));
    expect(summary?.context?.textureMs).toEqual(expect.any(Number));
    expect(summary?.context?.applyMs).toEqual(expect.any(Number));
    expect(summary?.context?.renderMs).toEqual(expect.any(Number));
    controller.destroy();
  });

  it("discards a stale source whose load resolves after a newer one", async () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const deferred = new Map<
      string,
      { resolve: (m: LoadedBackgroundMedia) => void; texture: ReturnType<typeof fakeTexture> }
    >();
    const loadMedia = (src: string) =>
      new Promise<LoadedBackgroundMedia>((resolve) => {
        const texture = fakeTexture();
        deferred.set(src, { resolve, texture });
      });
    const makeImage = (texture: ReturnType<typeof fakeTexture>): LoadedBackgroundMedia => ({
      type: "image",
      element: document.createElement("img"),
      texture: texture as never,
      width: 10,
      height: 10,
    });
    const { controller } = makeController({ loadMedia });
    const pA = controller.setSource("a.png", "image");
    await tick();
    const pB = controller.setSource("b.png", "image");
    // Let the (shared) app build and both loadMedia calls register before resolving.
    await tick();
    expect(deferred.has("a.png")).toBe(true);
    expect(deferred.has("b.png")).toBe(true);
    // Resolve the NEWER request first, then the stale older one.
    const textureB = deferred.get("b.png");
    textureB?.resolve(makeImage(textureB.texture));
    await pB;
    const textureA = deferred.get("a.png");
    textureA?.resolve(makeImage(textureA.texture));
    await pA;
    // The stale "a" texture must be discarded, not left assigned to the sprite.
    expect(textureA?.texture.destroy).toHaveBeenCalled();
    expect(textureB?.texture.destroy).not.toHaveBeenCalled();
    expect(controller.stats.textureSwaps).toBe(1);
    controller.destroy();
  });

  it("aborts an in-flight media load when a newer source supersedes it", async () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const abortError = () => new DOMException("Superseded", "AbortError");
    const signals: Array<{ src: string; signal: AbortSignal }> = [];
    const loadMedia = (src: string, signal: AbortSignal) =>
      new Promise<LoadedBackgroundMedia>((_resolve, reject) => {
        signals.push({ src, signal });
        signal.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    const { controller, onError } = makeController({ loadMedia });

    const pA = controller.setSource("a.png", "image");
    await tick();
    expect(signals[0]).toMatchObject({ src: "a.png" });

    const pB = controller.setSource("b.png", "image");
    await tick();
    expect(signals[0].signal.aborted).toBe(true);
    expect(signals[1]).toMatchObject({ src: "b.png" });

    controller.destroy();
    await Promise.all([pA, pB]);
    expect(signals[1].signal.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("can delay starting media load so rapid switches can settle first", async () => {
    vi.useFakeTimers();
    const loadMedia = vi.fn(
      async (): Promise<LoadedBackgroundMedia> => ({
        type: "image",
        element: document.createElement("img"),
        texture: fakeTexture() as never,
        width: 100,
        height: 100,
      }),
    );
    const { controller } = makeController({ loadDelayMs: 180, loadMedia });

    const pending = controller.setSource("a.png", "image");
    await vi.advanceTimersByTimeAsync(0);
    expect(loadMedia).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(179);
    expect(loadMedia).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(loadMedia).toHaveBeenCalledTimes(1);
    expect(loadMedia).toHaveBeenCalledWith("a.png", expect.any(AbortSignal));
    controller.destroy();
  });

  it("crossfades cover→cover under the resident filter: 2nd sprite fades in, old disposed on completion", async () => {
    // Drive the tween deterministically: capture each requested frame callback and
    // flush it with a controlled timestamp so we can step the fade 0→1 by hand.
    const frames: Array<(t: number) => void> = [];
    const requestFrame = (cb: (t: number) => void) => {
      frames.push(cb);
      return () => {};
    };
    const flush = (t: number) => {
      const pending = frames.splice(0, frames.length);
      for (const cb of pending) cb(t);
    };

    const module = fakeModule();
    const filter = { id: "filter" };
    const host = document.createElement("div");
    const controller = createPixiBackgroundController({
      host,
      effect: "noise",
      effectOptions: {} as never,
      pixelSize: 12,
      preference: "webgl",
      powerPreference: "low-power",
      crossfadeMs: 360,
      deps: {
        loadPixi: async () => module,
        loadMedia: async (_pixi, _src): Promise<LoadedBackgroundMedia> => ({
          type: "image",
          element: document.createElement("img"),
          texture: fakeTexture() as never,
          width: 100,
          height: 100,
          unload: vi.fn(),
        }),
        loadFilter: async () => filter,
        requestFrame,
        onError: vi.fn(),
      },
    });

    await controller.setSource("a.png", "image");
    const stage = module.apps[0].stage;
    const spriteA = stage.addChild.mock.calls[0][0] as {
      alpha: number;
      texture: ReturnType<typeof fakeTexture>;
      destroy: ReturnType<typeof vi.fn>;
    };
    const textureA = spriteA.texture;
    expect(spriteA.alpha).toBe(1);
    expect(frames.length).toBe(0); // first cover never crossfades

    await controller.setSource("b.png", "image");
    // The incoming cover is a SECOND sprite added under the same resident filter,
    // starting transparent — the old one is still mounted (not yet disposed).
    expect(stage.addChild).toHaveBeenCalledTimes(2);
    const spriteB = stage.addChild.mock.calls[1][0] as { alpha: number; filters: unknown[] };
    expect(spriteB.alpha).toBe(0);
    expect(spriteB.filters).toEqual([filter]);
    expect(spriteA.destroy).not.toHaveBeenCalled();
    expect(textureA.destroy).not.toHaveBeenCalled();
    expect(stage.removeChild).not.toHaveBeenCalled();

    // Step the tween: at the midpoint the incoming sprite is partway in (0 < a < 1).
    flush(0);
    flush(180);
    expect(spriteB.alpha).toBeGreaterThan(0);
    expect(spriteB.alpha).toBeLessThan(1);
    expect(spriteA.destroy).not.toHaveBeenCalled();

    // On completion the incoming is fully shown and the outgoing sprite + texture are freed.
    flush(360);
    expect(spriteB.alpha).toBe(1);
    expect(stage.removeChild).toHaveBeenCalledWith(spriteA);
    expect(textureA.destroy).toHaveBeenCalled();
    expect(spriteA.destroy).toHaveBeenCalled();

    controller.destroy();
  });

  it("skips a delayed media load when a newer source supersedes it before decode starts", async () => {
    vi.useFakeTimers();
    const loadMedia = vi.fn(
      async (src: string): Promise<LoadedBackgroundMedia> => ({
        type: "image",
        element: document.createElement("img"),
        texture: fakeTexture() as never,
        width: src === "b.png" ? 200 : 100,
        height: src === "b.png" ? 200 : 100,
      }),
    );
    const { controller, onError } = makeController({ loadDelayMs: 180, loadMedia });

    const stale = controller.setSource("a.png", "image");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    const landed = controller.setSource("b.png", "image");
    await vi.advanceTimersByTimeAsync(0);

    await stale;
    expect(loadMedia).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(180);
    await landed;
    expect(loadMedia).toHaveBeenCalledTimes(1);
    expect(loadMedia).toHaveBeenCalledWith("b.png", expect.any(AbortSignal));
    expect(controller.stats.textureSwaps).toBe(1);
    expect(onError).not.toHaveBeenCalled();
    controller.destroy();
  });
});
