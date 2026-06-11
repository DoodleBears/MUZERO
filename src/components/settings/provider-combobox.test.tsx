import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { allLlmProviderPresets } from "@/ai/llm-providers";
import { DEFAULT_SETTINGS } from "@/db/types";
import { ProviderCombobox } from "./provider-combobox";

const labels = {
  trigger: "Provider",
  searchPlaceholder: "Search providers",
  empty: "None",
  keyReady: "Key ready",
  keyOptional: "Key optional",
  keyMissing: "No key",
};

describe("ProviderCombobox", () => {
  it("shows brand icons + key status per provider and reports the picked id", () => {
    const onSelect = vi.fn();
    const settings = { ...DEFAULT_SETTINGS, apiKeysByPresetId: { openai: "sk-x" } };
    render(
      <ProviderCombobox
        labels={labels}
        onSelect={onSelect}
        presets={allLlmProviderPresets()}
        selectedId="openai"
        settings={settings}
      />,
    );

    // Trigger shows the active provider; open the list.
    fireEvent.click(screen.getByRole("button", { name: "Provider" }));

    // Each item renders an svg (brand glyph or generic chip).
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(3);
    expect(options.every((o) => o.querySelector("svg"))).toBe(true);

    // OpenAI has a key → ready; Claude has none → missing.
    expect(screen.getByText("Key ready")).toBeInTheDocument();
    expect(screen.getAllByText("No key").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Claude"));
    expect(onSelect).toHaveBeenCalledWith("claude");
  });
});
