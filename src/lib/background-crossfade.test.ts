import { describe, expect, it } from "vitest";
import {
  backgroundCrossfadeProgress,
  type CrossfadeDirection,
  crossfadeIndexDelta,
  crossfadeLayerOpacities,
} from "./background-crossfade";

describe("backgroundCrossfadeProgress", () => {
  it("is at rest with no drag", () => {
    expect(backgroundCrossfadeProgress(0, 300)).toEqual({
      direction: "none",
      progress: 0,
      currentOpacity: 1,
      incomingOpacity: 0,
    });
  });

  it("reveals the NEXT track when dragged left (negative x), fading it in by progress", () => {
    const half = backgroundCrossfadeProgress(-150, 300);
    expect(half.direction).toBe("next");
    expect(half.progress).toBeCloseTo(0.5);
    expect(half.currentOpacity).toBe(1);
    expect(half.incomingOpacity).toBeCloseTo(0.5);
  });

  it("reveals the PREVIOUS track when dragged right (positive x)", () => {
    const q = backgroundCrossfadeProgress(75, 300);
    expect(q.direction).toBe("prev");
    expect(q.progress).toBeCloseTo(0.25);
    expect(q.incomingOpacity).toBeCloseTo(0.25);
  });

  it("clamps progress to 1 on an over-drag", () => {
    const over = backgroundCrossfadeProgress(-600, 300);
    expect(over.progress).toBe(1);
    expect(over.incomingOpacity).toBe(1);
  });

  it("applies gain so the background can lead the cover", () => {
    const led = backgroundCrossfadeProgress(-150, 300, 1.5);
    expect(led.progress).toBeCloseTo(0.75);
  });

  it("returns at-rest for non-finite drag or missing width", () => {
    expect(backgroundCrossfadeProgress(Number.NaN, 300).direction).toBe("none");
    expect(backgroundCrossfadeProgress(-150, 0).direction).toBe("none");
  });
});

describe("crossfadeIndexDelta", () => {
  it("maps direction to a queue-index delta", () => {
    const cases: [CrossfadeDirection, number][] = [
      ["next", 1],
      ["prev", -1],
      ["none", 0],
    ];
    for (const [dir, delta] of cases) {
      expect(crossfadeIndexDelta(dir)).toBe(delta);
    }
  });
});

describe("crossfadeLayerOpacities", () => {
  it("fades only the next layer when dragging left", () => {
    expect(crossfadeLayerOpacities(-150, 300)).toEqual({ next: 0.5, prev: 0 });
  });

  it("fades only the prev layer when dragging right", () => {
    expect(crossfadeLayerOpacities(150, 300)).toEqual({ next: 0, prev: 0.5 });
  });

  it("keeps both layers hidden at rest", () => {
    expect(crossfadeLayerOpacities(0, 300)).toEqual({ next: 0, prev: 0 });
  });
});
