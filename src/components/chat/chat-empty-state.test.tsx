import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatEmptyState, type ChatEmptyStateLabels } from "./chat-empty-state";

const labels: ChatEmptyStateLabels = {
  body: "Shape a set from your library or start with a vibe.",
  presets: "Prompt presets",
  startWithVibe: "Start with a vibe",
  title: "Ask the DJ",
  uploadLibrary: "Upload music",
};

describe("ChatEmptyState", () => {
  it("inserts preset prompts without sending them", () => {
    const onInsertPrompt = vi.fn();

    render(
      <ChatEmptyState
        labels={labels}
        onInsertPrompt={onInsertPrompt}
        presets={[
          { id: "late", label: "Late night", prompt: "make a late-night lofi set" },
          { id: "gym", label: "Gym", prompt: "make a gym set" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Late night" }));

    expect(onInsertPrompt).toHaveBeenCalledWith("make a late-night lofi set");
  });

  it("routes library and vibe guide actions through callbacks", () => {
    const onStartWithVibe = vi.fn();
    const onUploadLibrary = vi.fn();

    render(
      <ChatEmptyState
        labels={labels}
        onStartWithVibe={onStartWithVibe}
        onUploadLibrary={onUploadLibrary}
        presets={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Upload music" }));
    fireEvent.click(screen.getByRole("button", { name: "Start with a vibe" }));

    expect(onUploadLibrary).toHaveBeenCalled();
    expect(onStartWithVibe).toHaveBeenCalled();
  });
});
