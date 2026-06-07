import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { VirtualTrackList } from "./virtual-track-list";

const useVirtualizerMock = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: unknown) => useVirtualizerMock(options),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/stores/player-store", () => ({
  usePlayerStore: (selector: (state: unknown) => unknown) =>
    selector({
      currentIndex: -1,
      playIndex: vi.fn(),
      queue: [],
    }),
}));

vi.mock("./track-row", () => ({
  TrackRow: ({ track }: { track: Track }) => (
    <div data-testid={`track-row-${track.id}`}>{track.title}</div>
  ),
}));

function track(id: string, title: string): Track {
  return {
    createdAt: 1,
    durationSec: 60,
    id,
    kind: "audio",
    liked: false,
    origin: "uploaded",
    playCount: 0,
    provider: "mock",
    sessionId: "ses_1",
    status: "ready",
    tags: [],
    title,
    updatedAt: 1,
  } as Track;
}

describe("VirtualTrackList", () => {
  it("uses dynamic measurement for adaptive-height playlist rows", () => {
    const measureElement = vi.fn();
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 144,
      getVirtualItems: () => [
        { index: 0, key: "trk_1", size: 64, start: 0 },
        { index: 1, key: "trk_2", size: 80, start: 64 },
      ],
      measureElement,
    });

    render(<VirtualTrackList tracks={[track("trk_1", "First"), track("trk_2", "Second")]} />);

    expect(useVirtualizerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        estimateSize: expect.any(Function),
        getItemKey: expect.any(Function),
        measureElement: expect.any(Function),
      }),
    );
    expect(screen.getByTestId("virtual-track-list")).toHaveAttribute(
      "data-virtualized",
      "dynamic-size",
    );
    expect(screen.getByTestId("virtual-track-row-trk_1")).toHaveAttribute("data-index", "0");
    expect(screen.getByTestId("virtual-track-row-trk_1").style.height).toBe("");
    expect(screen.getByTestId("track-row-trk_2")).toHaveTextContent("Second");
  });
});
