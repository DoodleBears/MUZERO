import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { VirtualTrackList } from "./virtual-track-list";

const { playerState, useVirtualizerMock } = vi.hoisted(() => ({
  playerState: {
    currentIndex: -1,
    playIndex: vi.fn(),
    queue: [] as Track[],
  },
  useVirtualizerMock: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: unknown) => useVirtualizerMock(options),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/stores/player-store", () => ({
  usePlayerStore: (selector: (state: unknown) => unknown) => selector(playerState),
}));

vi.mock("./track-row", () => ({
  TrackRow: ({
    listIndex,
    onPlay,
    onView,
    track,
  }: {
    listIndex: number;
    onPlay: () => void;
    onView: () => void;
    track: Track;
  }) => (
    <div
      data-muzero-track-row
      data-testid={`track-row-${track.id}`}
      data-track-index={listIndex}
      onClick={onView}
      onDoubleClick={onPlay}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onView();
      }}
      role="option"
      tabIndex={0}
    >
      {track.title}
    </div>
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
    playerState.currentIndex = -1;
    playerState.queue = [];
    playerState.playIndex.mockClear();
    useVirtualizerMock.mockReset();
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

  it("uses single click for view and double click for play when a view handler is provided", () => {
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 60,
      getVirtualItems: () => [{ index: 0, key: "trk_1", size: 60, start: 0 }],
    });
    const onView = vi.fn();
    const onPlay = vi.fn();

    render(<VirtualTrackList tracks={[track("trk_1", "First")]} onView={onView} onPlay={onPlay} />);

    fireEvent.click(screen.getByTestId("track-row-trk_1"));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: "trk_1" }), 0);
    expect(onPlay).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByTestId("track-row-trk_1"));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: "trk_1" }), 0);
  });

  it("restores an explicit anchor row with center alignment", () => {
    vi.useFakeTimers();
    const scrollToIndex = vi.fn();
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 120,
      getVirtualItems: () => [
        { index: 0, key: "trk_1", size: 60, start: 0 },
        { index: 1, key: "trk_2", size: 60, start: 60 },
      ],
      scrollToIndex,
    });

    render(
      <VirtualTrackList
        tracks={[track("trk_1", "First"), track("trk_2", "Second")]}
        initialScrollAlign="center"
        initialScrollIndex={1}
      />,
    );

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: "center" });
  });

  it("focuses an explicit jump row on mount", () => {
    vi.useFakeTimers();
    const scrollToIndex = vi.fn();
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 120,
      getVirtualItems: () => [
        { index: 0, key: "trk_1", size: 60, start: 0 },
        { index: 1, key: "trk_2", size: 60, start: 60 },
      ],
      scrollToIndex,
    });

    render(
      <VirtualTrackList
        tracks={[track("trk_1", "First"), track("trk_2", "Second")]}
        jumpFocusIndex={1}
        jumpScrollIndex={1}
      />,
    );

    vi.runAllTimers();

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: "center" });
    expect(screen.getByTestId("track-row-trk_2")).toHaveFocus();
  });

  it("does not auto-scroll when an initial restore index changes after mount", () => {
    vi.useFakeTimers();
    const scrollToIndex = vi.fn();
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 120,
      getVirtualItems: () => [
        { index: 0, key: "trk_1", size: 60, start: 0 },
        { index: 1, key: "trk_2", size: 60, start: 60 },
      ],
      scrollToIndex,
    });

    const { rerender } = render(
      <VirtualTrackList tracks={[track("trk_1", "First"), track("trk_2", "Second")]} />,
    );
    scrollToIndex.mockClear();

    rerender(
      <VirtualTrackList
        tracks={[track("trk_1", "First"), track("trk_2", "Second")]}
        initialScrollAlign="center"
        initialScrollIndex={1}
      />,
    );
    vi.runAllTimers();

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("scrolls and focuses when an explicit jump anchor arrives after the list has mounted", () => {
    vi.useFakeTimers();
    const scrollToIndex = vi.fn();
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 120,
      getVirtualItems: () => [
        { index: 0, key: "trk_1", size: 60, start: 0 },
        { index: 1, key: "trk_2", size: 60, start: 60 },
      ],
      scrollToIndex,
    });

    const { rerender } = render(
      <VirtualTrackList tracks={[track("trk_1", "First"), track("trk_2", "Second")]} />,
    );
    scrollToIndex.mockClear();

    rerender(
      <VirtualTrackList
        tracks={[track("trk_1", "First"), track("trk_2", "Second")]}
        jumpFocusIndex={1}
        jumpScrollIndex={1}
      />,
    );
    vi.runAllTimers();

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: "center" });
    expect(screen.getByTestId("track-row-trk_2")).toHaveFocus();

    rerender(<VirtualTrackList tracks={[track("trk_1", "First"), track("trk_2", "Second")]} />);
    scrollToIndex.mockClear();

    rerender(
      <VirtualTrackList
        tracks={[track("trk_1", "First"), track("trk_2", "Second")]}
        jumpFocusIndex={1}
        jumpScrollIndex={1}
      />,
    );

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: "center" });
  });

  it("offers a floating jump button for the current playing row", () => {
    const scrollToIndex = vi.fn();
    const first = track("trk_1", "First");
    const second = track("trk_2", "Second");
    playerState.currentIndex = 0;
    playerState.queue = [second];
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 120,
      getVirtualItems: () => [
        { index: 0, key: "trk_1", size: 60, start: 0 },
        { index: 1, key: "trk_2", size: 60, start: 60 },
      ],
      isScrolling: true,
      scrollToIndex,
    });

    render(<VirtualTrackList tracks={[first, second]} />);

    const jumpButton = screen.getByRole("button", { name: "track.jumpToCurrent" });

    expect(screen.getByTestId("virtual-track-list-region")).toContainElement(jumpButton);
    expect(screen.getByTestId("virtual-track-list")).not.toContainElement(jumpButton);
    expect(jumpButton).toHaveClass("top-4", "right-8", "bg-popover/95", "ring-border/50");
    expect(jumpButton).not.toHaveClass("bg-primary", "text-primary-foreground");
    expect(jumpButton.querySelector("svg")).toHaveClass("size-5");

    fireEvent.click(jumpButton);

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: "center" });
  });

  it("keeps the floating jump button visible for ten seconds after scrolling stops", () => {
    vi.useFakeTimers();
    const first = track("trk_1", "First");
    const second = track("trk_2", "Second");
    let isScrolling = true;
    playerState.currentIndex = 0;
    playerState.queue = [second];
    useVirtualizerMock.mockImplementation(() => ({
      getTotalSize: () => 120,
      getVirtualItems: () => [
        { index: 0, key: "trk_1", size: 60, start: 0 },
        { index: 1, key: "trk_2", size: 60, start: 60 },
      ],
      isScrolling,
      scrollToIndex: vi.fn(),
    }));

    const { rerender } = render(<VirtualTrackList tracks={[first, second]} />);

    expect(screen.getByRole("button", { name: "track.jumpToCurrent" })).toBeInTheDocument();

    isScrolling = false;
    rerender(<VirtualTrackList tracks={[first, second]} />);

    expect(screen.getByRole("button", { name: "track.jumpToCurrent" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(9999));

    expect(screen.getByRole("button", { name: "track.jumpToCurrent" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));

    expect(screen.queryByRole("button", { name: "track.jumpToCurrent" })).not.toBeInTheDocument();
  });

  it("hides the floating jump button while the current playing list is idle", () => {
    const first = track("trk_1", "First");
    const second = track("trk_2", "Second");
    playerState.currentIndex = 0;
    playerState.queue = [second];
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 120,
      getVirtualItems: () => [
        { index: 0, key: "trk_1", size: 60, start: 0 },
        { index: 1, key: "trk_2", size: 60, start: 60 },
      ],
      isScrolling: false,
      scrollToIndex: vi.fn(),
    });

    render(<VirtualTrackList tracks={[first, second]} />);

    expect(screen.queryByRole("button", { name: "track.jumpToCurrent" })).not.toBeInTheDocument();
  });

  it("moves focus with arrow keys and views the focused track", () => {
    vi.useFakeTimers();
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 120,
      getVirtualItems: () => [
        { index: 0, key: "trk_1", size: 60, start: 0 },
        { index: 1, key: "trk_2", size: 60, start: 60 },
      ],
      scrollToIndex: vi.fn(),
    });
    const onView = vi.fn();

    render(
      <VirtualTrackList
        tracks={[track("trk_1", "First"), track("trk_2", "Second")]}
        onView={onView}
      />,
    );

    screen.getByTestId("track-row-trk_1").focus();
    fireEvent.keyDown(screen.getByTestId("virtual-track-list"), {
      code: "ArrowDown",
      key: "ArrowDown",
    });

    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: "trk_2" }), 1);
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
