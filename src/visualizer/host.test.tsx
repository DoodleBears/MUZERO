import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { shouldAnimate, VisualizerHost } from "./host";

describe("shouldAnimate", () => {
  it("runs when visible and on-screen", () => {
    expect(
      shouldAnimate({ active: true, hidden: false, onscreen: true, reducedMotion: false }),
    ).toBe(true);
  });
  it("pauses when inactive", () => {
    expect(
      shouldAnimate({ active: false, hidden: false, onscreen: true, reducedMotion: false }),
    ).toBe(false);
  });
  it("pauses when the tab is hidden", () => {
    expect(
      shouldAnimate({ active: true, hidden: true, onscreen: true, reducedMotion: false }),
    ).toBe(false);
  });
  it("pauses when the canvas is off-screen", () => {
    expect(
      shouldAnimate({ active: true, hidden: false, onscreen: false, reducedMotion: false }),
    ).toBe(false);
  });
  it("keeps visualizers running under reduced motion", () => {
    expect(
      shouldAnimate({ active: true, hidden: false, onscreen: true, reducedMotion: true }),
    ).toBe(true);
  });
});

describe("VisualizerHost", () => {
  it("mounts an aria-hidden canvas for a drawing style", () => {
    const { container } = render(<VisualizerHost active={false} styleId="bars" />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing when the style is off", () => {
    const { container } = render(<VisualizerHost active={false} styleId="off" />);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("falls back to a canvas when a scene is selected but WebGL is unavailable", () => {
    // Removed scene ids resolve through the registry fallback and still render safely.
    const { container } = render(<VisualizerHost active={false} styleId="scene-liquid" />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
