import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LLM_PROVIDER_PRESETS } from "@/ai/llm-providers";
import { clearModelCatalogCache } from "@/ai/model-catalog";
import { ModelCatalogCombobox } from "./model-catalog-combobox";

vi.mock("@/lib/platform", () => ({
  getAppFetch: async () =>
    (async () =>
      new Response(
        JSON.stringify({ data: [{ id: "live-model-a" }, { id: "gpt-4o-mini" }] }),
      )) as unknown as typeof fetch,
}));

const labels = {
  empty: "No models",
  loading: "Fetching…",
  refresh: "Refresh",
  searchPlaceholder: "Search models",
  trigger: "Pick a model",
  customLabel: (q: string) => `Use "${q}"`,
};

afterEach(() => clearModelCatalogCache());

describe("ModelCatalogCombobox", () => {
  it("merges hardcoded + live catalog and selects a fetched model", async () => {
    const onSelect = vi.fn();
    render(
      <ModelCatalogCombobox
        apiKey="sk"
        labels={labels}
        onSelect={onSelect}
        preset={LLM_PROVIDER_PRESETS.openai}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick a model" }));
    // Hardcoded model is present immediately; the live one arrives after fetch.
    expect(await screen.findByText(/gpt-4.1 mini/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("live-model-a")).toBeInTheDocument());

    fireEvent.click(screen.getByText("live-model-a"));
    expect(onSelect).toHaveBeenCalledWith("live-model-a");
  });

  it("offers a free-text custom model id when the query has no exact match", async () => {
    const onSelect = vi.fn();
    render(
      <ModelCatalogCombobox
        apiKey="sk"
        labels={labels}
        onSelect={onSelect}
        preset={LLM_PROVIDER_PRESETS.openai}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick a model" }));
    fireEvent.change(screen.getByPlaceholderText("Search models"), {
      target: { value: "o5-preview" },
    });
    fireEvent.click(await screen.findByText('Use "o5-preview"'));
    expect(onSelect).toHaveBeenCalledWith("o5-preview");
  });
});
