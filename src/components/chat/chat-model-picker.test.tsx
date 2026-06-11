import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LlmProviderPreset } from "@/ai/llm-providers";
import { ChatModelPicker, type ChatModelPickerLabels } from "./chat-model-picker";

const labels: ChatModelPickerLabels = {
  empty: "No enabled models",
  inherited: "Use global default",
  searchPlaceholder: "Search models",
  trigger: "Choose chat model",
};

const presets: LlmProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    provider: "openai-compatible",
    models: [{ id: "gpt-4.1-mini", label: "GPT-4.1 mini" }],
  },
  {
    id: "claude",
    label: "Claude",
    provider: "anthropic",
    models: [
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
      { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
    ],
  },
];

describe("ChatModelPicker", () => {
  it("shows the selected provider and model", () => {
    render(
      <ChatModelPicker
        labels={labels}
        onSelect={() => undefined}
        presets={presets}
        selectedModel="gpt-4.1-mini"
        selectedPresetId="openai"
      />,
    );

    expect(screen.getByRole("button", { name: "Choose chat model" })).toHaveTextContent(
      "OpenAI / GPT-4.1 mini",
    );
  });

  it("filters models and reports selected provider/model ids", async () => {
    const onSelect = vi.fn();
    render(<ChatModelPicker labels={labels} onSelect={onSelect} presets={presets} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose chat model" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Search models" }), {
      target: { value: "sonnet" },
    });
    fireEvent.click(screen.getByRole("option", { name: "Claude / Claude Sonnet 4.5" }));

    expect(onSelect).toHaveBeenCalledWith({
      model: "claude-sonnet-4-5-20250929",
      presetId: "claude",
    });
  });

  it("shows the inherited label and empty state when no models are enabled", async () => {
    render(<ChatModelPicker labels={labels} onSelect={() => undefined} presets={[]} />);

    expect(screen.getByRole("button", { name: "Choose chat model" })).toHaveTextContent(
      "Use global default",
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose chat model" }));
    expect(await screen.findByText("No enabled models")).toBeInTheDocument();
  });
});
