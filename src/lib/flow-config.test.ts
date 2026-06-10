import { describe, expect, it } from "vitest";
import type { AppSettings } from "@/db/types";
import type { Rgb } from "@/lib/visualizer-color";
import {
  FLOW_DEFAULT_COLORS,
  hexToRgb,
  normalizeHexColor,
  resolveFlowColors,
  resolveFlowConfig,
} from "./flow-config";

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });

describe("normalizeHexColor", () => {
  it("keeps a valid 6-digit hex (lowercased, # added)", () => {
    expect(normalizeHexColor("#1A2B3C")).toBe("#1a2b3c");
    expect(normalizeHexColor("1a2b3c")).toBe("#1a2b3c");
  });
  it("expands 3-digit shorthand", () => {
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
    expect(normalizeHexColor("ABC")).toBe("#aabbcc");
  });
  it("rejects garbage", () => {
    expect(normalizeHexColor("nope")).toBeNull();
    expect(normalizeHexColor("#12")).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor("#12345g")).toBeNull();
  });
});

describe("hexToRgb", () => {
  it("parses to channels", () => {
    expect(hexToRgb("#ff8800")).toEqual(rgb(255, 136, 0));
    expect(hexToRgb("#fff")).toEqual(rgb(255, 255, 255));
  });
  it("returns null for invalid", () => {
    expect(hexToRgb("xyz")).toBeNull();
  });
});

describe("resolveFlowColors", () => {
  const palette = [rgb(10, 20, 30), rgb(40, 50, 60), rgb(70, 80, 90)];
  const custom = [rgb(1, 1, 1), rgb(2, 2, 2)];

  it("uses the cover palette when source is cover and it has >= 2 colors", () => {
    expect(resolveFlowColors("cover", palette, custom)).toEqual(palette);
  });
  it("falls back to custom when cover palette is empty/too small", () => {
    expect(resolveFlowColors("cover", [], custom)).toEqual(custom);
    expect(resolveFlowColors("cover", [rgb(9, 9, 9)], custom)).toEqual(custom);
  });
  it("always uses custom when source is custom, ignoring the cover palette", () => {
    expect(resolveFlowColors("custom", palette, custom)).toEqual(custom);
  });
});

describe("resolveFlowConfig", () => {
  it("applies calm defaults for an empty settings row", () => {
    const cfg = resolveFlowConfig({} as AppSettings);
    expect(cfg.source).toBe("cover");
    expect(cfg.effect).toBe("ambient-light");
    expect(cfg.speed).toBeCloseTo(0.4);
    expect(cfg.scale).toBeCloseTo(0.5);
    expect(cfg.reactivity).toBeCloseTo(0.2);
    expect(cfg.customColors.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a valid effect id and falls back to ambient-light for unknown/empty", () => {
    expect(resolveFlowConfig({ flowEffect: "aesthetic-fluid" } as AppSettings).effect).toBe(
      "aesthetic-fluid",
    );
    expect(resolveFlowConfig({ flowEffect: "grid-array" } as AppSettings).effect).toBe(
      "grid-array",
    );
    // A stale/unknown id (e.g. a removed v1 effect) → default.
    expect(resolveFlowConfig({ flowEffect: "aurora-drift" } as unknown as AppSettings).effect).toBe(
      "ambient-light",
    );
  });

  it("normalizes + clamps the 0–100 sliders to 0–1", () => {
    expect(resolveFlowConfig({ flowMotion: 200 } as AppSettings).speed).toBe(1);
    expect(resolveFlowConfig({ flowMotion: -5 } as AppSettings).speed).toBe(0);
    expect(resolveFlowConfig({ flowAudioReactivity: 100 } as AppSettings).reactivity).toBe(1);
  });

  it("parses custom colors and falls back to defaults when too few are valid", () => {
    const cfg = resolveFlowConfig({ flowCustomColors: ["#ff0000", "#00ff00"] } as AppSettings);
    expect(cfg.customColors).toEqual([rgb(255, 0, 0), rgb(0, 255, 0)]);

    const bad = resolveFlowConfig({ flowCustomColors: ["nope", "#xyz"] } as AppSettings);
    expect(bad.customColors.length).toBeGreaterThanOrEqual(2); // defaults
  });

  it("preserves an explicit custom source", () => {
    expect(resolveFlowConfig({ flowColorSource: "custom" } as AppSettings).source).toBe("custom");
  });

  it("ships sane default colors", () => {
    expect(FLOW_DEFAULT_COLORS.length).toBeGreaterThanOrEqual(2);
    for (const c of FLOW_DEFAULT_COLORS) expect(normalizeHexColor(c)).not.toBeNull();
  });
});
