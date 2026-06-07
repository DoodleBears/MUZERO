import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { AnnotationEditor } from "./annotation-editor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
  }),
}));

vi.mock("@/components/track/track-memory-notes-panel", () => ({
  TrackMemoryNotesPanel: ({
    labels,
    trackId,
  }: {
    labels: { composer: { notePlaceholder: string }; createMemory: string };
    trackId: string;
  }) => (
    <div data-testid="memory-panel" data-track-id={trackId}>
      {labels.composer.notePlaceholder}
      {labels.createMemory}
    </div>
  ),
}));

const track: Track = {
  createdAt: 1,
  durationSec: 60,
  id: "trk_memory",
  kind: "audio",
  liked: false,
  origin: "generated",
  playCount: 0,
  provider: "mock",
  sessionId: "ses_1",
  status: "ready",
  tags: ["rain"],
  title: "Rain Loop",
};

describe("AnnotationEditor", () => {
  it("uses the memory notes panel instead of the deprecated single note field", () => {
    render(<AnnotationEditor track={track} />);

    expect(screen.getByTestId("memory-panel")).toHaveAttribute("data-track-id", "trk_memory");
    expect(screen.getByTestId("memory-panel")).toHaveTextContent("annotation.notePlaceholder");
    expect(screen.getByTestId("memory-panel")).toHaveTextContent("annotation.createMemory");
    expect(screen.queryByPlaceholderText("annotation.notePlaceholder")).not.toBeInTheDocument();
  });

  it("keeps the memory notes panel out of the tag and cover chrome", () => {
    render(<AnnotationEditor track={track} />);

    const memoryPanelParentClass =
      screen.getByTestId("memory-panel").parentElement?.className ?? "";

    expect(memoryPanelParentClass).not.toContain("bg-card/80");
  });
});
