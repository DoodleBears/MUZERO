import { describe, expect, it } from "vitest";
import { type AudienceRequestSource, DEFAULT_AUDIENCE_REQUEST_SOURCE } from "@/db/types";
import { findSource, resolveSourceMapping, resolveSources } from "./audience-request-sources";
import { REQUEST_MAPPING_PRESETS } from "./request-mapping-presets";

const src = (over: Partial<AudienceRequestSource>): AudienceRequestSource => ({
  id: "x",
  name: "X",
  status: "active",
  authMode: "open",
  mappingPreset: "auto",
  ...over,
});

describe("audience-request-sources", () => {
  it("backfills a default source when none are configured", () => {
    expect(resolveSources(undefined)).toEqual([DEFAULT_AUDIENCE_REQUEST_SOURCE]);
    expect(resolveSources([])).toEqual([DEFAULT_AUDIENCE_REQUEST_SOURCE]);
    const configured = [src({ id: "ssn" })];
    expect(resolveSources(configured)).toBe(configured);
  });

  it("finds by id, falling back to the default source for an absent id", () => {
    const sources = [DEFAULT_AUDIENCE_REQUEST_SOURCE, src({ id: "ssn" })];
    expect(findSource(sources, "ssn")?.id).toBe("ssn");
    expect(findSource(sources, undefined)?.id).toBe("default");
    expect(findSource(sources, "")?.id).toBe("default");
    expect(findSource(sources, "unknown")).toBeUndefined();
  });

  it("resolves the effective mapping per preset", () => {
    expect(resolveSourceMapping(src({ mappingPreset: "auto" }))).toBeNull();
    expect(resolveSourceMapping(src({ mappingPreset: "social-stream-ninja" }))).toEqual(
      REQUEST_MAPPING_PRESETS["social-stream-ninja"],
    );
    expect(
      resolveSourceMapping(src({ mappingPreset: "custom", mapping: { query: "{{ payload.q }}" } })),
    ).toEqual({ query: "{{ payload.q }}" });
    expect(resolveSourceMapping(src({ mappingPreset: "custom" }))).toBeNull();
  });
});
