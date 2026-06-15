import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BackgroundLayer } from "@/lib/background-composition";
import { BackgroundFrameStack } from "./background-frame-stack";
import type { ControllerFrame } from "./use-background-controller";

const layer = (
  generation: number,
  trackId: string,
  coverUrl: string,
): BackgroundLayer<ControllerFrame> => ({
  frame: { trackId, coverUrl, source: "cover", mediaType: "image", rendererKind: "blur" },
  generation,
  opacity: 0,
  ready: true,
});

const canvases = (root: HTMLElement) => Array.from(root.querySelectorAll("canvas"));

describe("BackgroundFrameStack", () => {
  it("renders one canvas per layer", () => {
    const { container } = render(
      <BackgroundFrameStack
        layers={[layer(1, "a", "a.jpg"), layer(2, "b", "b.jpg")]}
        blurPx={64}
        onTopSettled={() => {}}
      />,
    );
    expect(canvases(container)).toHaveLength(2);
  });

  it("keeps the base layer's DOM node when a new top layer is pushed (keyed by generation)", () => {
    const { container, rerender } = render(
      <BackgroundFrameStack
        layers={[layer(1, "a", "a.jpg")]}
        blurPx={64}
        onTopSettled={() => {}}
      />,
    );
    const base = canvases(container)[0];

    rerender(
      <BackgroundFrameStack
        layers={[layer(1, "a", "a.jpg"), layer(2, "b", "b.jpg")]}
        blurPx={64}
        onTopSettled={() => {}}
      />,
    );
    const after = canvases(container);
    expect(after).toHaveLength(2);
    // Same DOM node reused for generation 1 → no remount of the held base.
    expect(after[0]).toBe(base);
  });

  it("collapsing back to the base unmounts the upper layer", () => {
    const { container, rerender } = render(
      <BackgroundFrameStack
        layers={[layer(1, "a", "a.jpg"), layer(2, "b", "b.jpg")]}
        blurPx={64}
        onTopSettled={() => {}}
      />,
    );
    expect(canvases(container)).toHaveLength(2);
    rerender(
      <BackgroundFrameStack
        layers={[layer(2, "b", "b.jpg")]}
        blurPx={64}
        onTopSettled={() => {}}
      />,
    );
    expect(canvases(container)).toHaveLength(1);
  });
});
