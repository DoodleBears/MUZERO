import { describe, expect, it } from "vitest";
import {
  createVisualizer,
  getVisualizerMeta,
  isRegisteredVisualizerStyle,
  resolveVisualizerStyle,
  VISUALIZER_META,
  VISUALIZER_PICKER_META,
  VISUALIZER_STYLE_IDS,
} from "./registry";

describe("VISUALIZER_META / IDS", () => {
  it("registers at least off + bars, in order", () => {
    expect(VISUALIZER_STYLE_IDS).toContain("off");
    expect(VISUALIZER_STYLE_IDS).toContain("bars");
  });
  it("every meta entry is complete and valid", () => {
    for (const m of VISUALIZER_META) {
      expect(m.labelKey).toMatch(/^visualizer\./);
      expect(m.fftSize).toBeGreaterThan(0);
      // power of two (Web Audio requirement)
      expect(Math.log2(m.fftSize) % 1).toBe(0);
      expect(m.smoothing).toBeGreaterThanOrEqual(0);
      expect(m.smoothing).toBeLessThanOrEqual(1);
    }
  });
  it("ids are unique", () => {
    expect(new Set(VISUALIZER_STYLE_IDS).size).toBe(VISUALIZER_STYLE_IDS.length);
  });
});

describe("isRegisteredVisualizerStyle", () => {
  it("accepts registered ids", () => {
    expect(isRegisteredVisualizerStyle("bars")).toBe(true);
    expect(isRegisteredVisualizerStyle("off")).toBe(true);
  });
  it("rejects unimplemented union ids and garbage", () => {
    expect(isRegisteredVisualizerStyle("milkdrop")).toBe(false); // in union, deferred to v2
    expect(isRegisteredVisualizerStyle("nope")).toBe(false);
    expect(isRegisteredVisualizerStyle(undefined)).toBe(false);
    expect(isRegisteredVisualizerStyle(42)).toBe(false);
  });
});

describe("resolveVisualizerStyle (fallback)", () => {
  it("keeps a registered id", () => {
    expect(resolveVisualizerStyle("bars")).toBe("bars");
    expect(resolveVisualizerStyle("off")).toBe("off");
  });
  it("falls back to bars for undefined / unknown / not-yet-implemented", () => {
    expect(resolveVisualizerStyle(undefined)).toBe("bars");
    expect(resolveVisualizerStyle("garbage")).toBe("bars");
    expect(resolveVisualizerStyle("milkdrop")).toBe("bars"); // deferred to v2, not registered
  });
});

describe("getVisualizerMeta", () => {
  it("returns the matching meta", () => {
    expect(getVisualizerMeta("bars").kind).toBe("spectrum");
    expect(getVisualizerMeta("off").id).toBe("off");
  });
});

describe("createVisualizer", () => {
  it("returns null for off", () => {
    expect(createVisualizer("off")).toBeNull();
  });
  it("builds the bars renderer with the Visualizer shape", () => {
    const v = createVisualizer("bars");
    expect(v?.id).toBe("bars");
    expect(typeof v?.init).toBe("function");
    expect(typeof v?.render).toBe("function");
    expect(typeof v?.destroy).toBe("function");
  });
  it("registers + builds the remaining spectrum styles", () => {
    for (const id of ["bars", "radial", "led-reflex", "waveform"] as const) {
      expect(isRegisteredVisualizerStyle(id)).toBe(true);
      expect(resolveVisualizerStyle(id)).toBe(id);
      expect(createVisualizer(id)?.id).toBe(id);
    }
  });
  it("registers scene-flow as kind=scene with no canvas renderer", () => {
    for (const id of ["scene-flow"] as const) {
      expect(isRegisteredVisualizerStyle(id)).toBe(true);
      expect(resolveVisualizerStyle(id)).toBe(id);
      expect(getVisualizerMeta(id).kind).toBe("scene");
      expect(getVisualizerMeta(id).backend).toBe("webgl");
      expect(createVisualizer(id)).toBeNull(); // React component, not a canvas renderer
    }
  });

  it("removes Aura, Liquid, and Aurora from registered user-selectable styles", () => {
    for (const id of ["aura", "scene-liquid", "scene-aurora"] as const) {
      expect(isRegisteredVisualizerStyle(id)).toBe(false);
      expect(resolveVisualizerStyle(id)).toBe("bars");
      expect(VISUALIZER_PICKER_META.some((m) => m.id === id)).toBe(false);
    }
  });

  it("keeps scene-flow registered but hides it from the style picker (layer-only)", () => {
    // Renderable via explicit styleId (the independent flow background layer)…
    expect(isRegisteredVisualizerStyle("scene-flow")).toBe(true);
    expect(getVisualizerMeta("scene-flow").hidden).toBe(true);
    // …but never offered as a spectrum choice (not mutually exclusive with the picker).
    expect(VISUALIZER_PICKER_META.some((m) => m.id === "scene-flow")).toBe(false);
    expect(VISUALIZER_PICKER_META.some((m) => m.id === "bars")).toBe(true);
    expect(VISUALIZER_PICKER_META.some((m) => m.id === "off")).toBe(true);
  });
});
