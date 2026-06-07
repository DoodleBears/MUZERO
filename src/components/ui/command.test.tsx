import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Command, type CommandItem } from "./command";

const items: CommandItem[] = [
  { id: "openai:gpt-5.2", label: "GPT-5.2", keywords: ["openai"] },
  { id: "anthropic:claude", label: "Claude Sonnet", keywords: ["anthropic"] },
  { id: "groq:llama", label: "Llama Groq", keywords: ["groq"] },
];

describe("Command primitive", () => {
  it("filters items by label and keywords", () => {
    render(
      <Command
        empty="No models"
        items={items}
        onSelect={() => undefined}
        placeholder="Search models"
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search models" }), {
      target: { value: "anthropic" },
    });

    expect(screen.getByRole("option", { name: "Claude Sonnet" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "GPT-5.2" })).not.toBeInTheDocument();
  });

  it("shows an empty state when no item matches", () => {
    render(
      <Command
        empty="No models"
        items={items}
        onSelect={() => undefined}
        placeholder="Search models"
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search models" }), {
      target: { value: "zzzz" },
    });

    expect(screen.getByText("No models")).toBeInTheDocument();
  });

  it("reports selected item ids", () => {
    const onSelect = vi.fn();
    render(
      <Command empty="No models" items={items} onSelect={onSelect} placeholder="Search models" />,
    );

    fireEvent.click(screen.getByRole("option", { name: "Llama Groq" }));

    expect(onSelect).toHaveBeenCalledWith("groq:llama");
  });
});
