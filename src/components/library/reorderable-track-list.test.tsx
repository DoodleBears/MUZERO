import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { ReorderableTrackList } from "./reorderable-track-list";

vi.mock("@/hooks/use-media", () => ({ useTrackThumbnailUrl: () => undefined }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function track(id: string, title: string): Track {
  return {
    id,
    sessionId: "ses_1",
    title,
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 60,
    createdAt: 1,
    playCount: 0,
    liked: false,
    tags: [],
  };
}

const tracks = Array.from({ length: 5 }, (_, i) => track(`t${i}`, `Track ${i}`));

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReorderableTrackList", () => {
  it("renders a sortable row per track", () => {
    render(
      <ReorderableTrackList
        tracks={tracks}
        selectedIds={new Set()}
        onToggleSelect={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    // Title + subtitle both echo the title for these metadata-less fixtures, so
    // assert on count rather than a unique match.
    for (let i = 0; i < 5; i++) {
      expect(screen.getAllByText(`Track ${i}`).length).toBeGreaterThan(0);
    }
  });

  it("gives every row a drag handle", () => {
    render(
      <ReorderableTrackList
        tracks={tracks}
        selectedIds={new Set()}
        onToggleSelect={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    expect(screen.getAllByLabelText("reorder.dragHandle")).toHaveLength(5);
  });

  it("toggles selection when a row body is clicked", () => {
    const onToggleSelect = vi.fn();
    render(
      <ReorderableTrackList
        tracks={tracks}
        selectedIds={new Set()}
        onToggleSelect={onToggleSelect}
        onReorder={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByText("Track 1")[0]);
    expect(onToggleSelect).toHaveBeenCalledWith("t1", { shiftKey: false });
  });
});
