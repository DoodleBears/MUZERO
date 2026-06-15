import { describe, expect, it } from "vitest";
import {
  type BackgroundComposition,
  type FrameLike,
  initialComposition,
  MAX_BACKGROUND_LAYERS,
  reduceComposition,
  topLayer,
} from "./background-composition";

const frame = (trackId: string): FrameLike => ({ trackId });

// Convenience: run a sequence of events from the initial state.
function run(
  ...events: Parameters<typeof reduceComposition>[1][]
): BackgroundComposition<FrameLike> {
  return events.reduce((s, e) => reduceComposition(s, e), initialComposition<FrameLike>());
}

describe("reduceComposition", () => {
  it("starts empty", () => {
    const s = initialComposition<FrameLike>();
    expect(s.layers).toEqual([]);
    expect(s.generation).toBe(0);
  });

  it("TARGET_CHANGED pushes a not-ready, transparent top layer and bumps generation", () => {
    const s = run({ type: "TARGET_CHANGED", frame: frame("a") });
    expect(s.generation).toBe(1);
    expect(s.layers).toHaveLength(1);
    expect(topLayer(s)).toMatchObject({ generation: 1, opacity: 0, ready: false });
    expect(topLayer(s)?.frame.trackId).toBe("a");
  });

  it("ignores a repeated TARGET_CHANGED for the same top track (noop)", () => {
    const s = run(
      { type: "TARGET_CHANGED", frame: frame("a") },
      { type: "TARGET_CHANGED", frame: frame("a") },
    );
    expect(s.generation).toBe(1);
    expect(s.layers).toHaveLength(1);
  });

  it("INCOMING_READY marks the top ready only for the current generation (stale ignored)", () => {
    const ready = run(
      { type: "TARGET_CHANGED", frame: frame("a") },
      { type: "INCOMING_READY", generation: 1 },
    );
    expect(topLayer(ready)?.ready).toBe(true);

    const stale = run(
      { type: "TARGET_CHANGED", frame: frame("a") },
      { type: "INCOMING_READY", generation: 99 },
    );
    expect(topLayer(stale)?.ready).toBe(false);
  });

  it("ADVANCE holds (no opacity change) until the top is ready — no flash", () => {
    const held = run(
      { type: "TARGET_CHANGED", frame: frame("a") },
      { type: "ADVANCE", progress: 0.7 },
    );
    expect(topLayer(held)?.opacity).toBe(0);
  });

  it("ADVANCE drives the ready top layer's opacity", () => {
    const s = run(
      { type: "TARGET_CHANGED", frame: frame("a") },
      { type: "INCOMING_READY", generation: 1 },
      { type: "ADVANCE", progress: 0.5 },
    );
    expect(topLayer(s)?.opacity).toBeCloseTo(0.5);
  });

  it("collapses to a single base layer once the top reaches full opacity", () => {
    const s = run(
      { type: "TARGET_CHANGED", frame: frame("a") },
      { type: "INCOMING_READY", generation: 1 },
      { type: "ADVANCE", progress: 1 },
    );
    expect(s.layers).toHaveLength(1);
    expect(topLayer(s)?.frame.trackId).toBe("a");
    expect(topLayer(s)?.opacity).toBe(1);
  });

  it("3-layer carry-over: switching mid-fade freezes the old top and fades a new one over it", () => {
    // Land 'a' as base, start fading 'b' to 0.5, then switch to 'c'.
    let s = run(
      { type: "TARGET_CHANGED", frame: frame("a") },
      { type: "INCOMING_READY", generation: 1 },
      { type: "ADVANCE", progress: 1 }, // a is base
      { type: "TARGET_CHANGED", frame: frame("b") },
      { type: "INCOMING_READY", generation: 2 },
      { type: "ADVANCE", progress: 0.5 }, // b fading at 0.5
    );
    expect(s.layers.map((l) => l.frame.trackId)).toEqual(["a", "b"]);

    s = reduceComposition(s, { type: "TARGET_CHANGED", frame: frame("c") });
    // b is frozen at 0.5 (NOT rebounded), c pushed on top at 0.
    expect(s.layers.map((l) => l.frame.trackId)).toEqual(["a", "b", "c"]);
    expect(s.layers.find((l) => l.frame.trackId === "b")?.opacity).toBeCloseTo(0.5);
    expect(topLayer(s)?.frame.trackId).toBe("c");
    expect(topLayer(s)?.opacity).toBe(0);

    // Completing c collapses everything below it.
    s = reduceComposition(s, { type: "INCOMING_READY", generation: 3 });
    s = reduceComposition(s, { type: "ADVANCE", progress: 1 });
    expect(s.layers.map((l) => l.frame.trackId)).toEqual(["c"]);
  });

  it("prunes a layer fully covered by an opaque upper layer", () => {
    // Reach a settled base, then immediately re-collapse keeps one layer.
    const s = run(
      { type: "TARGET_CHANGED", frame: frame("a") },
      { type: "INCOMING_READY", generation: 1 },
      { type: "ADVANCE", progress: 1 },
      { type: "TARGET_CHANGED", frame: frame("b") },
      { type: "INCOMING_READY", generation: 2 },
      { type: "ADVANCE", progress: 1 },
    );
    expect(s.layers.map((l) => l.frame.trackId)).toEqual(["b"]);
  });

  it("never grows the stack beyond MAX_BACKGROUND_LAYERS", () => {
    let s = initialComposition<FrameLike>();
    for (let i = 0; i < MAX_BACKGROUND_LAYERS + 3; i++) {
      s = reduceComposition(s, { type: "TARGET_CHANGED", frame: frame(`t${i}`) });
      s = reduceComposition(s, { type: "INCOMING_READY", generation: s.generation });
      s = reduceComposition(s, { type: "ADVANCE", progress: 0.3 }); // partial — never collapses
    }
    expect(s.layers.length).toBeLessThanOrEqual(MAX_BACKGROUND_LAYERS);
  });
});
