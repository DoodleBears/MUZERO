import { describe, expect, it } from "vitest";
import { MediaEngine } from "./media-engine";

/**
 * Playback is driven by a persistent <audio> element that NEVER leaves the
 * document — so music keeps playing across nav (a hidden/removed <video> gets
 * paused by the browser, but the audio element doesn't). A muted <video> is only
 * the visual layer for MV tracks; the stage adopts/releases it.
 */
describe("MediaEngine — audio driver stays in the document, video is the visual", () => {
  it("creates an audio driver + a video visual, both connected from the start", () => {
    const engine = new MediaEngine();
    expect(engine.element.tagName).toBe("VIDEO");
    expect(engine.element.isConnected).toBe(true);
  });

  it("mount adopts the (visual) video element into the stage", () => {
    const engine = new MediaEngine();
    const container = document.createElement("div");
    document.body.appendChild(container);
    engine.mount(container);
    expect(engine.element.parentElement).toBe(container);
    container.remove();
  });

  it("unmount returns the video to the host without disconnecting it", () => {
    const engine = new MediaEngine();
    const container = document.createElement("div");
    document.body.appendChild(container);
    engine.mount(container);
    engine.unmount();
    container.remove();
    // The audio driver is unaffected by the stage; the video is parked in the host.
    expect(engine.element.isConnected).toBe(true);
    expect(engine.element.parentElement).not.toBe(container);
  });

  it("loads a remote video URL into the visual element without requiring a Blob", async () => {
    const engine = new MediaEngine();
    await engine.loadUrl("https://music.example.com/muzero/objects/video.mp4", "video");

    expect(engine.element.src).toBe("https://music.example.com/muzero/objects/video.mp4");
  });
});
