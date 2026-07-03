import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/db/types";
import { isAsrConfigured, resolveAsrProvider, resolveGroqApiKey } from "./registry";

const base = DEFAULT_SETTINGS;

describe("resolveGroqApiKey", () => {
  it("prefers the ASR-specific key", () => {
    expect(
      resolveGroqApiKey({ ...base, groqApiKey: "asr-key", apiKeysByPresetId: { groq: "dj-key" } }),
    ).toBe("asr-key");
  });

  it("falls back to the DJ's configured Groq key (PRD Q6 reuse)", () => {
    expect(resolveGroqApiKey({ ...base, apiKeysByPresetId: { groq: "dj-key" } })).toBe("dj-key");
  });

  it("returns undefined when neither is set", () => {
    expect(resolveGroqApiKey(base)).toBeUndefined();
    expect(resolveGroqApiKey({ ...base, groqApiKey: "   " })).toBeUndefined();
  });
});

describe("resolveAsrProvider / isAsrConfigured", () => {
  it("is null / not configured without a key", () => {
    expect(resolveAsrProvider(base)).toBeNull();
    expect(isAsrConfigured(base)).toBe(false);
  });

  it("builds a groq provider once a key is present", () => {
    const settings = { ...base, groqApiKey: "sk-test" };
    const provider = resolveAsrProvider(settings);
    expect(provider?.id).toBe("groq");
    expect(isAsrConfigured(settings)).toBe(true);
  });
});
