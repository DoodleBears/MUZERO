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
        "dock.memory": "Memory",
        "dock.playlist": "Playlist",
        "dock.lyrics": "Lyrics",
        "queue.empty": "Queue empty",
      })[key] ?? key,
  }),
}));

vi.mock("@/components/ui/disc-3", () => ({
  Disc3Icon: ({ className }: { className?: string }) => (
    <span className={className} data-testid="disc-3-icon" />
  ),
}));

vi.mock("@/components/ui/message-circle-more", () => ({
  MessageCircleMoreIcon: ({ className }: { className?: string }) => (
    <span className={className} data-testid="message-circle-more-icon" />
  ),
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (query: () => unknown) => {
    const result = query();
    if (Array.isArray(result)) return result;
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
  VirtualTrackList: ({ className }: { className?: string }) => (
    <div className={className} data-testid="queue-list" />
  ),
}));

vi.mock("@/components/player/synced-lyrics-view", () => ({
  SyncedLyricsView: () => <div data-testid="lyrics-view" />,
}));

vi.mock("@/components/player/memory-timeline-rail", () => ({
  MemoryTimelineRail: ({
    initialOffset,
    memories,
    onOffsetChange,
  }: {
    initialOffset?: number;
    memories: unknown[];
    onOffsetChange?: (offsetPx: number) => void;
  }) =>
    (() => {
      mocks.timelineMemories = memories;
      return (
        <button
          data-count={memories.length}
          data-offset={initialOffset}
          data-testid="memory-timeline-rail"
          onClick={() => onOffsetChange?.(160)}
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

  it("switches from lyrics to memory with the floating toggle", () => {
    mocks.memories = [{ createdAt: 1, id: "mem_1", note: "late bus", trackId: "trk_current" }];
    render(<NowPlayingPanel collapsible />);

    expect(screen.getByTestId("now-playing-panel")).toHaveAttribute("data-state", "expanded");
    expect(screen.getByTestId("lyrics-view")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Memory" });
    expect(toggle).toHaveAttribute("data-testid", "now-playing-panel-floating-toggle");
    fireEvent.click(toggle);

    expect(mocks.saveSettings).toHaveBeenCalledWith({
      lyricsStageOpen: false,
      nowPlayingRightRailCollapsed: true,
    });
  });

  it("switches from memory to lyrics with the floating toggle", () => {
    mocks.collapsed = true;
    mocks.memories = [{ createdAt: 1, id: "mem_1", note: "late bus", trackId: "trk_current" }];

    render(<NowPlayingPanel collapsible />);

    expect(screen.getByTestId("now-playing-panel")).toHaveAttribute("data-state", "collapsed");
    expect(screen.getByRole("button", { name: "Lyrics" })).toContainElement(
      screen.getByTestId("disc-3-icon"),
    );
    expect(screen.queryByTestId("lyrics-view")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lyrics" }));

    expect(mocks.saveSettings).toHaveBeenCalledWith({
      lyricsStageOpen: true,
      nowPlayingRightRailCollapsed: false,
    });
  });

  it("does not show the memory toggle when the current track has no memories", () => {
    render(<NowPlayingPanel collapsible />);

    expect(screen.queryByRole("button", { name: "Memory" })).not.toBeInTheDocument();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
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
