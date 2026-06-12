import { describe, expect, it, vi } from "vitest";
import {
  needsCrossOrigin,
  shouldFetchImageTexture,
  syncLayerTicker,
} from "./pixi-pixel-background";

function tickerStub(started = false) {
  const ticker = {
    started,
    start: vi.fn(() => {
      ticker.started = true;
    }),
    stop: vi.fn(() => {
      ticker.started = false;
    }),
  };
  return ticker;
}

/**
 * The layer's ticker drives `app.render()` every frame — it must run ONLY while
 * a video is actually progressing. Static covers (noise/CRT over an image) and
 * paused MVs render on demand instead of burning GPU at 60fps (PRD F-6).
 */
describe("syncLayerTicker", () => {
  const video = document.createElement("video");

  it("starts the ticker for a playing video layer", () => {
    const ticker = tickerStub(false);
    syncLayerTicker({ media: video, app: { ticker } }, true);
    expect(ticker.start).toHaveBeenCalledTimes(1);
  });

  it("does not double-start an already running ticker", () => {
    const ticker = tickerStub(true);
    syncLayerTicker({ media: video, app: { ticker } }, true);
    expect(ticker.start).not.toHaveBeenCalled();
    expect(ticker.stop).not.toHaveBeenCalled();
  });

  it("stops the ticker when playback pauses", () => {
    const ticker = tickerStub(true);
    syncLayerTicker({ media: video, app: { ticker } }, false);
    expect(ticker.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps image layers (no media) stopped even while music plays", () => {
    const ticker = tickerStub(true);
    syncLayerTicker({ media: undefined, app: { ticker } }, true);
    expect(ticker.stop).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on an already stopped image layer", () => {
    const ticker = tickerStub(false);
    syncLayerTicker({ media: undefined, app: { ticker } }, false);
    expect(ticker.start).not.toHaveBeenCalled();
    expect(ticker.stop).not.toHaveBeenCalled();
  });
});

/**
 * Shared CORS opt-in rule for Pixi background textures (image + video loaders).
 * Remote covers in the BROWSER arrive as raw https (no media proxy) — without
 * `crossOrigin` the WebGL upload taints and the filter layer silently falls
 * back to a plain <img>, which read as "filters work on Electron but not in
 * Chrome".
 */
describe("needsCrossOrigin", () => {
  it("opts remote and proxied sources into CORS", () => {
    expect(needsCrossOrigin("https://pub-xxxx.r2.dev/covers/a.png")).toBe(true);
    expect(needsCrossOrigin("http://cdn.example.com/cover.jpg")).toBe(true);
    expect(needsCrossOrigin("muzfetch://proxy/abc123")).toBe(true);
    expect(needsCrossOrigin("MUZFETCH://proxy/abc123")).toBe(true);
  });

  it("leaves same-origin object/data URLs alone", () => {
    expect(needsCrossOrigin("blob:http://localhost:1440/9f6a")).toBe(false);
    expect(needsCrossOrigin("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
    expect(needsCrossOrigin("/muzero-logo.png")).toBe(false);
  });
});

describe("shouldFetchImageTexture", () => {
  it("fetches raw http image textures so Pixi samples a local blob URL", () => {
    expect(shouldFetchImageTexture("https://pub-xxxx.r2.dev/objects/covers/sha256-blue.jpg")).toBe(
      true,
    );
    expect(shouldFetchImageTexture("http://cdn.example.com/cover.jpg")).toBe(true);
  });

  it("leaves already-local or scheme-proxied sources to the media element loader", () => {
    expect(shouldFetchImageTexture("blob:http://localhost:1440/9f6a")).toBe(false);
    expect(shouldFetchImageTexture("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
    expect(shouldFetchImageTexture("muzfetch://media/?__mzurl=https%3A%2F%2Fx")).toBe(false);
  });
});
