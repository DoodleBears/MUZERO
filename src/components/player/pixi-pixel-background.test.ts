import { describe, expect, it } from "vitest";
import { needsCrossOrigin } from "./pixi-pixel-background";

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
