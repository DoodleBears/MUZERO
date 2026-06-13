import { describe, expect, it, vi } from "vitest";
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
    stage: { addChild: vi.fn() },
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
        scale: { set: vi.fn() },
        position: { set: vi.fn() },
      } as never;
    },
    Texture: { from: () => fakeTexture() },
  };
  return module as unknown as PixiModuleLike & { apps: FakeApp[] };
}

function makeController(overrides?: {
  preference?: "webgl" | "webgpu";
  powerPreference?: "high-performance" | "low-power";
  loadMedia?: (src: string) => Promise<LoadedBackgroundMedia>;
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
    deps: {
      loadPixi: async () => module,
      loadMedia: async (_pixi, src) => loadMedia(src),
      loadFilter: async () => null,
      onError,
    },
  });
  return { module, textures, host, controller, onError };
}

describe("createPixiBackgroundController", () => {
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
});
