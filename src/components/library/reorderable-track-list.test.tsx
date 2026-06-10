import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { ReorderableTrackList } from "./reorderable-track-list";

const ROW_H = 56;

// Mock the virtualizer to render a fixed WINDOW (indices 0..2 of a 5-track set).
// This both keeps jsdom layout-free and proves the list is actually virtualized:
// rows outside the window must not be in the DOM.
const visibleIndices = [0, 1, 2];
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 5 * ROW_H,
    getVirtualItems: () =>
      visibleIndices.map((index) => ({
        index,
        start: index * ROW_H,
        size: ROW_H,
        key: `t${index}`,
      })),
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-media", () => ({ useTrackCoverUrl: () => undefined }));
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

describe("ReorderableTrackList (virtualized)", () => {
  it("renders only the virtualizer's window, not every track", () => {
    render(
      <ReorderableTrackList
        tracks={tracks}
        selectedIds={new Set()}
        onToggleSelect={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    // Windowed rows present… (title + subtitle both echo the title for these
    // metadata-less fixtures, so assert on count rather than a unique match).
    expect(screen.getAllByText("Track 0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Track 2").length).toBeGreaterThan(0);
    // …off-window rows are NOT mounted (proves virtualization).
    expect(screen.queryAllByText("Track 3")).toHaveLength(0);
    expect(screen.queryAllByText("Track 4")).toHaveLength(0);
  });

  it("gives each visible row a drag handle", () => {
    render(
      <ReorderableTrackList
        tracks={tracks}
        selectedIds={new Set()}
        onToggleSelect={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    expect(screen.getAllByLabelText("reorder.dragHandle")).toHaveLength(visibleIndices.length);
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
