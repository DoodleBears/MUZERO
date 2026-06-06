import { describe, expect, it } from "vitest";
import type { TrackBrief } from "@/dj/dj-brief-schema";
import { CLOUD_PRESET_IDS, type CloudPresetId, resolveCloudPreset } from "./index";

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
});
