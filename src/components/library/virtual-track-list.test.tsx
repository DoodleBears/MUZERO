import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses fixed-height virtual rows so panel animations cannot disturb spacing", () => {
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 144,
      getVirtualItems: () => [
        { index: 0, key: "trk_1", size: 64, start: 0 },
        { index: 1, key: "trk_2", size: 80, start: 64 },
      ],
    });

    render(<VirtualTrackList tracks={[track("trk_1", "First"), track("trk_2", "Second")]} />);

    expect(useVirtualizerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        estimateSize: expect.any(Function),
        getItemKey: expect.any(Function),
      }),
    );
    expect(screen.getByTestId("virtual-track-list")).toHaveAttribute(
      "data-virtualized",
      "fixed-size",
    );
    expect(screen.getByTestId("virtual-track-row-trk_1")).toHaveAttribute("data-index", "0");
    expect(screen.getByTestId("virtual-track-row-trk_1").style.height).toBe("64px");
    expect(screen.getByTestId("track-row-trk_2")).toHaveTextContent("Second");
  });

  it("adds edge elasticity and calls the pull-start callback after the threshold", () => {
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 120,
      getVirtualItems: () => [{ index: 0, key: "trk_1", size: 60, start: 0 }],
    });
    const onPullPastStart = vi.fn();

    render(
      <VirtualTrackList tracks={[track("trk_1", "First")]} onPullPastStart={onPullPastStart} />,
    );

    const list = screen.getByTestId("virtual-track-list");
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 40, writable: true },
    });
    fireEvent.wheel(list, { deltaY: -80 });
    expect(onPullPastStart).not.toHaveBeenCalled();

    list.scrollTop = 0;
    fireEvent.wheel(list, { deltaY: 80 });
    expect(onPullPastStart).not.toHaveBeenCalled();

    fireEvent.wheel(list, { deltaY: -48 });
    expect(screen.getByTestId("virtual-track-list").firstElementChild).toHaveAttribute(
      "data-edge-pull",
      "22",
    );
    expect(onPullPastStart).not.toHaveBeenCalled();

    fireEvent.wheel(list, { deltaY: -48 });
    expect(onPullPastStart).toHaveBeenCalledTimes(1);
  });

  it("does not add top elasticity on the same scroll that reaches the top", () => {
    vi.useFakeTimers();
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 120,
      getVirtualItems: () => [{ index: 0, key: "trk_1", size: 60, start: 0 }],
    });

    render(<VirtualTrackList edgePullFeedback tracks={[track("trk_1", "First")]} />);

    const list = screen.getByTestId("virtual-track-list");
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    fireEvent.scroll(list);
    fireEvent.wheel(list, { deltaY: -48 });

    expect(screen.getByTestId("virtual-track-list").firstElementChild).toHaveAttribute(
      "data-edge-pull",
      "0",
    );

    vi.advanceTimersByTime(80);
    fireEvent.wheel(list, { deltaY: -48 });

    expect(screen.getByTestId("virtual-track-list").firstElementChild).toHaveAttribute(
      "data-edge-pull",
      "22",
    );
  });

  it("can show bottom edge elasticity without binding a load-more action", () => {
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 120,
      getVirtualItems: () => [{ index: 0, key: "trk_1", size: 60, start: 0 }],
    });

    render(<VirtualTrackList edgePullFeedback tracks={[track("trk_1", "First")]} />);

    const list = screen.getByTestId("virtual-track-list");
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 200, writable: true },
    });

    fireEvent.wheel(list, { deltaY: 48 });

    expect(screen.getByTestId("virtual-track-list").firstElementChild).toHaveAttribute(
      "data-edge-pull",
      "-22",
    );
  });

  it("does not show bottom elasticity when only the top pull action is enabled", () => {
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 120,
      getVirtualItems: () => [{ index: 0, key: "trk_1", size: 60, start: 0 }],
    });

    render(<VirtualTrackList onPullPastStart={vi.fn()} tracks={[track("trk_1", "First")]} />);

    const list = screen.getByTestId("virtual-track-list");
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 200, writable: true },
    });

    fireEvent.wheel(list, { deltaY: 48 });

    expect(screen.getByTestId("virtual-track-list").firstElementChild).toHaveAttribute(
      "data-edge-pull",
      "0",
    );
  });
});
