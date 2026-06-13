import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/db/types";
import {
  matchActiveQualityPreset,
  QUALITY_PRESET_BUNDLES,
  resolveQualityPresetSettings,
} from "./graphics-quality";

describe("resolveQualityPresetSettings", () => {
  it("battery turns the heavy layers off and prefers low power", () => {
    const b = resolveQualityPresetSettings("battery");
    expect(b.visualizerAsBackground).toBe(false);
    expect(b.flowEnabled).toBe(false);
    expect(b.immersiveIdle).toBe(false);
    expect(b.backgroundGpuPowerPreference).toBe("low-power");
  });

  it("quality enables the full effect stack", () => {
    const q = resolveQualityPresetSettings("quality");
    expect(q.visualizerAsBackground).toBe(true);
    expect(q.flowEnabled).toBe(true);
    expect(q.backgroundRenderer).toBe("noise");
  });
});

describe("matchActiveQualityPreset", () => {
  it("derives the preset whose bundle the settings match", () => {
    expect(matchActiveQualityPreset({ ...QUALITY_PRESET_BUNDLES.battery })).toBe("battery");
    expect(matchActiveQualityPreset({ ...QUALITY_PRESET_BUNDLES.balanced })).toBe("balanced");
    expect(matchActiveQualityPreset({ ...QUALITY_PRESET_BUNDLES.quality })).toBe("quality");
  });

  it("treats the app defaults as the quality preset", () => {
    expect(matchActiveQualityPreset(DEFAULT_SETTINGS)).toBe("quality");
  });

  it("returns custom when the settings are a mix of presets", () => {
    expect(matchActiveQualityPreset({ ...QUALITY_PRESET_BUNDLES.battery, flowEnabled: true })).toBe(
      "custom",
    );
  });

  it("matches by effective value, ignoring undefined (uses defaults)", () => {
    // immersiveIdle undefined → defaults to true, same as the quality bundle.
    const { immersiveIdle: _omit, ...withoutIdle } = QUALITY_PRESET_BUNDLES.quality;
    expect(matchActiveQualityPreset(withoutIdle)).toBe("quality");
  });
});
