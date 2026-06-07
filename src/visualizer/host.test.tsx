import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { shouldAnimate, VisualizerHost } from "./host";

describe("shouldAnimate", () => {
  it("runs only when visible, on-screen, and motion is allowed", () => {
    expect(shouldAnimate({ hidden: false, onscreen: true, reducedMotion: false })).toBe(true);
  });
  it("pauses when the tab is hidden", () => {
    expect(shouldAnimate({ hidden: true, onscreen: true, reducedMotion: false })).toBe(false);
  });
  it("pauses when the canvas is off-screen", () => {
    expect(shouldAnimate({ hidden: false, onscreen: false, reducedMotion: false })).toBe(false);
  });
  it("pauses (freezes) under reduced motion", () => {
    expect(shouldAnimate({ hidden: false, onscreen: true, reducedMotion: true })).toBe(false);
  });
});

describe("VisualizerHost", () => {
  it("mounts an aria-hidden canvas for a drawing style", () => {
    const { container } = render(<VisualizerHost active={false} styleId="aura" />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing when the style is off", () => {
    const { container } = render(<VisualizerHost active={false} styleId="off" />);
    expect(container.querySelector("canvas")).toBeNull();
  });
});
