import { describe, expect, it } from "vitest";
import { type AppSettings, DEFAULT_SETTINGS } from "@/db/types";
import { canUseDjChat, hasUsableLlm, hasUsableMusicgen } from "./dj-chat-availability";

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

describe("hasUsableMusicgen", () => {
  it("is true for the offline mock provider (no key needed)", () => {
    expect(hasUsableMusicgen(settings({ musicGenProvider: "mock" }))).toBe(true);
  });

  it("is false for cloud without a key", () => {
    expect(hasUsableMusicgen(settings({ musicGenProvider: "cloud" }))).toBe(false);
    expect(hasUsableMusicgen(settings({ musicGenProvider: "cloud", musicCloudApiKey: "  " }))).toBe(
      false,
    );
  });

  it("is true for a fixed-endpoint cloud preset with a key (mureka)", () => {
    expect(
      hasUsableMusicgen(
        settings({
          musicGenProvider: "cloud",
          musicCloudPreset: "mureka",
          musicCloudApiKey: "mk_x",
        }),
      ),
    ).toBe(true);
  });

  it("requires a base URL for the custom (user-endpoint) preset", () => {
    const base = {
      musicGenProvider: "cloud" as const,
      musicCloudPreset: "custom" as const,
      musicCloudApiKey: "k",
    };
    expect(hasUsableMusicgen(settings(base))).toBe(false);
    expect(hasUsableMusicgen(settings({ ...base, musicCloudUrl: "https://gen.example" }))).toBe(
      true,
    );
  });
});

describe("canUseDjChat", () => {
  it("requires BOTH llm and musicgen to be usable", () => {
    // neither
    expect(canUseDjChat(settings({ musicGenProvider: "cloud" }))).toBe(false);
    // llm only
    expect(
      canUseDjChat(settings({ apiKeysByPresetId: { openai: "sk" }, musicGenProvider: "cloud" })),
    ).toBe(false);
    // musicgen only (mock) without llm key
    expect(canUseDjChat(settings({ musicGenProvider: "mock" }))).toBe(false);
    // both
    expect(
      canUseDjChat(settings({ apiKeysByPresetId: { openai: "sk" }, musicGenProvider: "mock" })),
    ).toBe(true);
    expect(
      canUseDjChat(
        settings({
          openaiApiKey: "sk",
          musicGenProvider: "cloud",
          musicCloudPreset: "mureka",
          musicCloudApiKey: "mk",
        }),
      ),
    ).toBe(true);
  });
});
