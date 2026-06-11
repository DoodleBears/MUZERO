import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomLlmProvider } from "@/db/types";
import { DEFAULT_SETTINGS } from "@/db/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const saveSettings = vi.fn();
vi.mock("@/db/repositories", () => ({
  saveSettings: (...args: unknown[]) => saveSettings(...args),
}));

let settings = { ...DEFAULT_SETTINGS };
vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => settings,
}));

let customProviders: CustomLlmProvider[] = [];
const putCustomLlmProvider = vi.fn();
const deleteCustomLlmProvider = vi.fn();
vi.mock("@/ai/custom-llm-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ai/custom-llm-providers")>();
  return {
    ...actual,
    useCustomLlmProviders: () => customProviders,
    putCustomLlmProvider: (...args: unknown[]) => putCustomLlmProvider(...args),
    deleteCustomLlmProvider: (...args: unknown[]) => deleteCustomLlmProvider(...args),
  };
});

const openExternalUrl = vi.fn();
vi.mock("@/lib/platform", () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
}));

// The combobox is covered by its own tests; stub it to a marker.
vi.mock("@/components/chat/chat-model-picker", () => ({
  ChatModelPicker: ({ presets }: { presets: Array<{ id: string }> }) => (
    <div data-presets={presets.map((p) => p.id).join(",")} data-testid="model-picker" />
  ),
}));

import { LlmProviderSettings } from "./llm-provider-settings";

const vllm: CustomLlmProvider = {
  id: "custom:abc",
  label: "My vLLM",
  baseUrl: "http://localhost:8000/v1",
  models: [{ id: "qwen-7b" }, { id: "llama-8b" }],
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  settings = { ...DEFAULT_SETTINGS };
  customProviders = [];
  saveSettings.mockClear();
  putCustomLlmProvider.mockClear();
  deleteCustomLlmProvider.mockClear();
});

describe("LlmProviderSettings", () => {
  it("renders built-in presets with key status and customs from the hook", () => {
    settings = { ...DEFAULT_SETTINGS, apiKeysByPresetId: { groq: "gsk_x" } };
    customProviders = [vllm];
    render(<LlmProviderSettings />);
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("Groq")).toBeTruthy();
    expect(screen.getByText("My vLLM")).toBeTruthy();
    expect(screen.getAllByText("settings.llmKeyReady")).toHaveLength(1); // groq only
    expect(screen.getAllByText("settings.llmKeyOptional").length).toBeGreaterThan(0); // the custom
  });

  it("commits an API key for the selected provider on blur", () => {
    render(<LlmProviderSettings />);
    fireEvent.click(screen.getByText("Groq"));
    const input = screen.getByPlaceholderText("sk-…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: " gsk_secret " } });
    fireEvent.blur(input);
    expect(saveSettings).toHaveBeenCalledWith({
      apiKeysByPresetId: { groq: "gsk_secret" },
    });
  });

  it("adds a dynamic custom provider and opens its editor", async () => {
    render(<LlmProviderSettings />);
    fireEvent.click(screen.getByText("settings.llmAddCustom"));
    await waitFor(() => expect(putCustomLlmProvider).toHaveBeenCalledTimes(1));
    const created = putCustomLlmProvider.mock.calls[0][0] as CustomLlmProvider;
    expect(created.id.startsWith("custom:")).toBe(true);
    expect(created.models.length).toBeGreaterThan(0);
  });

  it("edits a custom provider: add model + delete provider", () => {
    customProviders = [vllm];
    render(<LlmProviderSettings />);
    fireEvent.click(screen.getByText("My vLLM"));

    const modelInput = screen.getByPlaceholderText("settings.llmCustomModelPlaceholder");
    fireEvent.change(modelInput, { target: { value: "mistral-7b" } });
    fireEvent.keyDown(modelInput, { key: "Enter" });
    expect(putCustomLlmProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "custom:abc",
        models: [{ id: "qwen-7b" }, { id: "llama-8b" }, { id: "mistral-7b" }],
      }),
    );

    fireEvent.click(screen.getByText("settings.llmCustomDelete"));
    expect(deleteCustomLlmProvider).toHaveBeenCalledWith("custom:abc");
  });

  it("feeds only enabled presets (keyed built-ins + customs) to the model picker", () => {
    settings = { ...DEFAULT_SETTINGS, apiKeysByPresetId: { groq: "gsk_x" } };
    customProviders = [vllm];
    render(<LlmProviderSettings />);
    expect(screen.getByTestId("model-picker").getAttribute("data-presets")).toBe("groq,custom:abc");
  });
});
