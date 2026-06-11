import { describe, expect, it } from "vitest";
import { type AppSettings, DEFAULT_SETTINGS } from "@/db/types";
import {
  canGenerateMusic,
  canUseDjChat,
  hasEnabledStreamSources,
  hasUsableLlm,
} from "./dj-chat-availability";

function settings(overrides: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("hasUsableLlm", () => {
  it("is false with no keys anywhere (fresh install)", () => {
    expect(hasUsableLlm(settings({}))).toBe(false);
  });

  it("is true when any preset has a key in apiKeysByPresetId", () => {
    expect(hasUsableLlm(settings({ apiKeysByPresetId: { groq: "gsk_x" } }))).toBe(true);
  });

  it("ignores blank keys", () => {
    expect(hasUsableLlm(settings({ apiKeysByPresetId: { openai: "   " } }))).toBe(false);
  });

  it("accepts legacy openai/anthropic key fields", () => {
    expect(hasUsableLlm(settings({ openaiApiKey: "sk-x" }))).toBe(true);
    expect(hasUsableLlm(settings({ anthropicApiKey: "sk-ant-x" }))).toBe(true);
  });
});

describe("canUseDjChat", () => {
  it("requires only a usable LLM — music generation is NOT required", () => {
    expect(canUseDjChat(settings({}))).toBe(false); // no llm
    expect(canUseDjChat(settings({ apiKeysByPresetId: { openai: "sk" } }))).toBe(true); // llm only
    expect(canUseDjChat(settings({ openaiApiKey: "sk" }))).toBe(true);
  });
});

describe("canGenerateMusic", () => {
  it("is false when generation is disabled (the default), even with a cloud key", () => {
    expect(canGenerateMusic(settings({}))).toBe(false);
    expect(canGenerateMusic(settings({ musicCloudPreset: "mureka", musicCloudApiKey: "mk" }))).toBe(
      false,
    );
  });

  it("needs the toggle on AND a cloud key", () => {
    expect(canGenerateMusic(settings({ aiDjGenerationEnabled: true }))).toBe(false); // no key
    expect(
      canGenerateMusic(
        settings({
          aiDjGenerationEnabled: true,
          musicCloudPreset: "mureka",
          musicCloudApiKey: "mk",
        }),
      ),
    ).toBe(true);
  });

  it("requires a base URL for the user-endpoint custom preset", () => {
    const base = {
      aiDjGenerationEnabled: true,
      musicCloudPreset: "custom" as const,
      musicCloudApiKey: "k",
    };
    expect(canGenerateMusic(settings(base))).toBe(false);
    expect(canGenerateMusic(settings({ ...base, musicCloudUrl: "https://gen.example" }))).toBe(
      true,
    );
  });
});

describe("hasEnabledStreamSources", () => {
  it("is false when no source is enabled", () => {
    expect(hasEnabledStreamSources(settings({}))).toBe(false);
    expect(
      hasEnabledStreamSources(settings({ streamSources: { youtube: { enabled: false } } })),
    ).toBe(false);
  });

  it("is true when any source is enabled", () => {
    expect(
      hasEnabledStreamSources(settings({ streamSources: { netease: { enabled: true } } })),
    ).toBe(true);
  });
});
