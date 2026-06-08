import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { usePlayerStore } from "@/stores/player-store";
import { NowPlayingPanel } from "./now-playing-panel";

const mocks = vi.hoisted(() => ({
  anyOf: vi.fn(),
  collapsed: false,
  equals: vi.fn(),
  getMemoryPhoto: vi.fn(),
  memories: [] as { createdAt: number; id: string; note: string; trackId: string }[],
  memoryScrollTop: 0,
  saveSettings: vi.fn(),
  sortBy: vi.fn(),
  timelineMemories: [] as unknown[],
  where: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    init: () => undefined,
    type: "3rdParty",
  },
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "nowPlaying.closeQueue": "Close queue",
        "nowPlaying.lyrics": "Lyrics",
        "nowPlaying.playingFrom": "Playing from",
        "nowPlaying.upNext": "Up next",
        "annotation.memory": "Memory",
        "annotation.memoryEmpty": "No memories yet",
        "queue.empty": "Queue empty",
      })[key] ?? key,
  }),
}));

vi.mock("lucide-react", () => ({
  PanelBottomClose: ({ className }: { className?: string }) => (
    <svg className={className} data-testid="panel-bottom-close-icon" />
  ),
  PanelBottomOpen: ({ className }: { className?: string }) => (
    <svg className={className} data-testid="panel-bottom-open-icon" />
  ),
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (query: () => unknown) => {
    query();
    return mocks.memories;
  },
}));

vi.mock("@/db/muzero-db", () => ({
  db: {
    memories: {
      where: mocks.where,
    },
  },
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSession: () => ({ name: "Late Set" }),
  useSettings: () => ({
    nowPlayingMemoryRailScrollTop: mocks.memoryScrollTop,
    nowPlayingRightRailCollapsed: mocks.collapsed,
  }),
}));

vi.mock("@/db/repositories", () => ({
  getMemoryPhoto: mocks.getMemoryPhoto,
  saveSettings: mocks.saveSettings,
}));

vi.mock("@/components/library/virtual-track-list", () => ({
  VirtualTrackList: ({
    className,
    edgePullFeedback,
    onPullPastStart,
  }: {
    className?: string;
    edgePullFeedback?: boolean;
    onPullPastStart?: () => void;
  }) => (
    <div
      className={className}
      data-edge-pull-feedback={edgePullFeedback ? "true" : "false"}
      data-testid="queue-list"
      onWheel={() => onPullPastStart?.()}
    />
  ),
}));

vi.mock("@/components/player/memory-timeline-rail", () => ({
  MemoryTimelineRail: ({
    initialOffset,
    memories,
    onOffsetChange,
    onPullPastEnd,
    onPullPastStart,
  }: {
    initialOffset?: number;
    memories: unknown[];
    onOffsetChange?: (offsetPx: number) => void;
    onPullPastEnd?: () => void;
    onPullPastStart?: () => void;
  }) =>
    (() => {
      mocks.timelineMemories = memories;
      return (
        <button
          data-count={memories.length}
          data-offset={initialOffset}
          data-testid="memory-timeline-rail"
          onClick={() => onOffsetChange?.(160)}
          onWheel={(event) => {
            if (event.deltaY < 0) onPullPastStart?.();
            else onPullPastEnd?.();
          }}
          type="button"
        />
      );
    })(),
}));

describe("NowPlayingPanel collapse", () => {
  beforeEach(() => {
    mocks.anyOf.mockReset();
    mocks.collapsed = false;
    mocks.equals.mockReset();
    mocks.getMemoryPhoto.mockReset();
    mocks.memories = [];
    mocks.memoryScrollTop = 0;
    mocks.saveSettings.mockReset();
    mocks.sortBy.mockReset();
    mocks.timelineMemories = [];
    mocks.where.mockReset();
    mocks.where.mockReturnValue({ anyOf: mocks.anyOf, equals: mocks.equals });
    mocks.anyOf.mockReturnValue({ sortBy: mocks.sortBy });
    mocks.equals.mockReturnValue({ sortBy: mocks.sortBy });
    mocks.sortBy.mockResolvedValue(mocks.memories);
    usePlayerStore.setState({
      activeSessionId: "ses_1",
      currentIndex: 1,
      queue: [
        makeTrack("trk_previous", "Previous"),
        makeTrack("trk_current", "Current Song"),
        makeTrack("trk_next", "Next"),
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists collapse requests from the desktop right rail", () => {
    render(<NowPlayingPanel collapsible />);

    expect(screen.getByTestId("now-playing-panel")).toHaveAttribute("data-state", "expanded");
    expect(screen.getByTestId("queue-list").closest(".mt-chrome-top")).toBeInTheDocument();
    expect(screen.getByTestId("queue-list")).toHaveAttribute("data-edge-pull-feedback", "false");
    expect(screen.getByTestId("queue-list")).not.toHaveClass("pt-12");
    const collapseButton = screen.getByRole("button", { name: "Close queue" });
    expect(collapseButton).toHaveClass("flex-1");
    expect(collapseButton).toContainElement(screen.getByTestId("panel-bottom-close-icon"));
    fireEvent.click(collapseButton);

    expect(mocks.saveSettings).toHaveBeenCalledWith({ nowPlayingRightRailCollapsed: true });
  });

  it("keeps only the compact header when collapsed and can expand again", () => {
    mocks.collapsed = true;

    render(<NowPlayingPanel collapsible />);

    expect(screen.getByTestId("now-playing-panel")).toHaveAttribute("data-state", "collapsed");
    expect(screen.getByTestId("now-playing-panel-compact-header")).toHaveClass("rounded-b-none");
    expect(screen.getByRole("button", { name: "Up next" })).toContainElement(
      screen.getByTestId("panel-bottom-open-icon"),
    );
    expect(screen.queryByTestId("queue-list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Up next" }));

    expect(mocks.saveSettings).toHaveBeenCalledWith({ nowPlayingRightRailCollapsed: false });
  });

  it("expands the collapsed queue when the memory rail pulls past either edge", () => {
    vi.useFakeTimers();
    mocks.collapsed = true;

    render(<NowPlayingPanel collapsible />);

    fireEvent.wheel(screen.getByTestId("memory-timeline-rail"), { deltaY: 120 });
    vi.advanceTimersByTime(651);
    fireEvent.wheel(screen.getByTestId("memory-timeline-rail"), { deltaY: -120 });

    expect(mocks.saveSettings).toHaveBeenCalledTimes(2);
    expect(mocks.saveSettings).toHaveBeenNthCalledWith(1, {
      nowPlayingRightRailCollapsed: false,
    });
    expect(mocks.saveSettings).toHaveBeenNthCalledWith(2, {
      nowPlayingRightRailCollapsed: false,
    });
  });

  it("collapses the expanded queue when the queue list pulls past the top", () => {
    render(<NowPlayingPanel collapsible />);

    fireEvent.wheel(screen.getByTestId("queue-list"), { deltaY: -120 });

    expect(mocks.saveSettings).toHaveBeenCalledWith({ nowPlayingRightRailCollapsed: true });
  });

  it("ignores repeated boundary pulls during the same wheel gesture", () => {
    render(<NowPlayingPanel collapsible />);

    fireEvent.wheel(screen.getByTestId("queue-list"), { deltaY: -120 });
    fireEvent.wheel(screen.getByTestId("queue-list"), { deltaY: -120 });

    expect(mocks.saveSettings).toHaveBeenCalledTimes(1);
    expect(mocks.saveSettings).toHaveBeenCalledWith({ nowPlayingRightRailCollapsed: true });
  });

  it("feeds the collapsed memory rail from settings and persists its scroll position", () => {
    mocks.collapsed = true;
    mocks.memoryScrollTop = 200;
    mocks.memories = [{ createdAt: 1, id: "mem_1", note: "late bus", trackId: "trk_current" }];

    render(<NowPlayingPanel collapsible />);

    const rail = screen.getByTestId("memory-timeline-rail");
    expect(rail).toHaveAttribute("data-count", "1");
    expect(rail).toHaveAttribute("data-offset", "200");
    expect(mocks.timelineMemories).toEqual([
      expect.not.objectContaining({ trackTitle: expect.any(String) }),
    ]);

    fireEvent.click(rail);

    expect(mocks.saveSettings).toHaveBeenCalledWith({ nowPlayingMemoryRailScrollTop: 160 });
  });

  it("loads collapsed memory rail items for the current track only", () => {
    mocks.collapsed = true;

    render(<NowPlayingPanel collapsible />);

    expect(mocks.where).toHaveBeenCalledWith("trackId");
    expect(mocks.equals).toHaveBeenCalledWith("trk_current");
    expect(mocks.anyOf).not.toHaveBeenCalled();
  });
});

function makeTrack(id: string, title: string): Track {
  return {
    createdAt: 1,
    durationSec: 30,
    id,
    kind: "audio",
    liked: false,
    origin: "uploaded",
    playCount: 0,
    provider: "upload",
    sessionId: "ses_1",
    status: "ready",
    tags: [],
    title,
  };
}
