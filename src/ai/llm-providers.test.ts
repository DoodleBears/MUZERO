import { describe, expect, it } from "vitest";
import type { AppSettings } from "@/db/types";
import {
  defaultModelForPreset,
  enabledLlmPresetIds,
  llmSelectionFromSettings,
  resolveLlmProviderPreset,
} from "./llm-providers";

const baseSettings: AppSettings = {
  id: "app",
  llmProvider: "openai",
  llmModel: "gpt-4o-mini",
  musicGenProvider: "mock",
  locale: "en",
};

describe("LLM provider presets", () => {
  it("resolves known presets and falls back to openai", () => {
    expect(resolveLlmProviderPreset("openrouter").provider).toBe("openai-compatible");
    expect(resolveLlmProviderPreset("claude").provider).toBe("anthropic");
    expect(resolveLlmProviderPreset("nope").id).toBe("openai");
  });

  it("uses preset defaults when settings do not override provider/model", () => {
    expect(llmSelectionFromSettings(baseSettings)).toEqual({
      presetId: "openai",
      model: "gpt-4o-mini",
      apiKey: undefined,
    });
  });

  it("prefers new preset settings and per-preset keys over legacy fields", () => {
    expect(
      llmSelectionFromSettings({
        ...baseSettings,
        defaultLlmProviderPresetId: "openrouter",
        defaultLlmModel: "anthropic/claude-3.5-sonnet",
        openaiApiKey: "legacy",
        apiKeysByPresetId: { openrouter: "router-key" },
      }),
    ).toEqual({
      presetId: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      apiKey: "router-key",
    });
  });

  it("bridges legacy anthropic settings to the claude preset", () => {
    expect(
      llmSelectionFromSettings({
        ...baseSettings,
        llmProvider: "anthropic",
        llmModel: "claude-haiku-4-5-20251001",
        anthropicApiKey: "anthropic-key",
      }),
    ).toEqual({
      presetId: "claude",
      model: "claude-haiku-4-5-20251001",
      apiKey: "anthropic-key",
    });
  });

  it("lists only presets that have an API key configured", () => {
    expect(
      enabledLlmPresetIds({
        ...baseSettings,
        openaiApiKey: "openai-key",
        apiKeysByPresetId: { groq: "groq-key" },
      }),
    ).toEqual(["openai", "groq"]);
  });

  it("has a default model for every built-in preset", () => {
    for (const id of ["openrouter", "openai", "claude", "gemini", "groq", "deepseek", "custom"]) {
      expect(defaultModelForPreset(id)).toBeTruthy();
    }
  });
});
