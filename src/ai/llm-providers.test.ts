import { describe, expect, it } from "vitest";
import type { AppSettings } from "@/db/types";
import {
  defaultModelForPreset,
  enabledLlmPresetIds,
  llmModelForPreset,
  llmSelectionForChatSession,
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

  it("applies per-session provider and model overrides without copying API keys", () => {
    expect(
      llmSelectionForChatSession(
        {
          ...baseSettings,
          defaultLlmProviderPresetId: "openrouter",
          defaultLlmModel: "openai/gpt-4.1-mini",
          apiKeysByPresetId: { claude: "claude-key", openrouter: "router-key" },
        },
        {
          llmProviderPresetId: "claude",
          llmModel: "claude-sonnet-4-5-20250929",
        },
      ),
    ).toEqual({
      presetId: "claude",
      model: "claude-sonnet-4-5-20250929",
      apiKey: "claude-key",
    });
  });

  it("uses the preset default model when a session only overrides provider", () => {
    expect(
      llmSelectionForChatSession(
        {
          ...baseSettings,
          apiKeysByPresetId: { deepseek: "deepseek-key" },
        },
        { llmProviderPresetId: "deepseek" },
      ),
    ).toEqual({
      presetId: "deepseek",
      model: "deepseek-chat",
      apiKey: "deepseek-key",
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

  it("llmModelForPreset keeps a remembered model even if it isn't in the hardcoded list", () => {
    const preset = resolveLlmProviderPreset("openrouter");
    // A model picked from the live catalog (not in preset.models) must stick —
    // this is the model-switch-has-no-effect bug.
    const settings = {
      modelsByPresetId: { openrouter: "x-ai/grok-2" as string },
    } satisfies Pick<AppSettings, "modelsByPresetId">;
    expect(llmModelForPreset(settings, preset)).toBe("x-ai/grok-2");
    // No remembered model → the preset's first hardcoded model.
    expect(llmModelForPreset({ modelsByPresetId: {} }, preset)).toBe(preset.models[0]?.id);
  });
});
