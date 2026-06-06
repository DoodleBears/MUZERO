import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/db/types";
import type { TrackBrief } from "@/dj/dj-brief-schema";
import {
  CLOUD_PRESET_IDS,
  type CloudPresetId,
  continuousHourlyUsd,
  resolveCloudPreset,
} from "./index";

describe("cloud presets registry", () => {
  it("resolves the custom preset by id", () => {
    const p = resolveCloudPreset("custom");
    expect(p.id).toBe("custom");
    expect(p.authScheme).toBe("bearer");
    expect(p.fixedEndpoint).toBe(false);
  });

  it("falls back to custom for undefined or unknown ids", () => {
    expect(resolveCloudPreset(undefined).id).toBe("custom");
    expect(resolveCloudPreset("totally-unknown" as CloudPresetId).id).toBe("custom");
  });

  it("custom mappers delegate to the generic mapping", () => {
    const brief: TrackBrief = { title: "T", caption: "lofi", lyrics: "", durationSec: 60 };
    const body = resolveCloudPreset("custom").mappers.mapBriefToBody(brief, { baseUrl: "x" });
    expect(body).toMatchObject({ prompt: "lofi", duration_seconds: 60 });
  });

  it("lists registered preset ids including custom", () => {
    expect(CLOUD_PRESET_IDS).toContain("custom");
  });

  it("defaults to mureka (quality-first) and lists it first in the dropdown", () => {
    expect(DEFAULT_SETTINGS.musicCloudPreset).toBe("mureka");
    expect(CLOUD_PRESET_IDS[0]).toBe("mureka");
  });
});

describe("preset cost metadata", () => {
  it("carries an estimated $/song for the priced presets", () => {
    expect(resolveCloudPreset("ace-step").estCostPerSongUsd).toBeCloseTo(0.012, 3);
    expect(resolveCloudPreset("mureka").estCostPerSongUsd).toBeCloseTo(0.045, 3);
    expect(resolveCloudPreset("custom").estCostPerSongUsd).toBeUndefined();
  });

  it("derives a continuous hourly estimate (20 songs/hr)", () => {
    expect(continuousHourlyUsd(0.012)).toBeCloseTo(0.24, 2);
    expect(continuousHourlyUsd(0.045)).toBeCloseTo(0.9, 2);
  });
});

describe("preset api-key links", () => {
  it("priced presets deep-link to their key page; custom has none", () => {
    expect(resolveCloudPreset("ace-step").apiKeyUrl).toContain("fal.ai");
    expect(resolveCloudPreset("mureka").apiKeyUrl).toContain("mureka.ai");
    expect(resolveCloudPreset("custom").apiKeyUrl).toBeUndefined();
  });
});

describe("preset capability metadata (Settings concreteness)", () => {
  it("flags whether the vendor takes a model param", () => {
    // fal's ace-step endpoint IS the model — no model param, so Settings hides it.
    expect(resolveCloudPreset("ace-step").usesModel).toBe(false);
    expect(resolveCloudPreset("mureka").usesModel).toBe(true);
    expect(resolveCloudPreset("custom").usesModel).toBe(true);
  });

  it("links priced presets to their API docs", () => {
    expect(resolveCloudPreset("ace-step").docsUrl).toContain("fal.ai");
    expect(resolveCloudPreset("mureka").docsUrl).toContain("platform.mureka.ai");
    expect(resolveCloudPreset("custom").docsUrl).toBeUndefined();
  });
});
