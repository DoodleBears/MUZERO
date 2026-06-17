import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { usePlayerStore } from "@/stores/player-store";
import { QueuePanel } from "./queue-panel";

vi.mock("react-i18next", () => ({
  initReactI18next: {
    init: () => undefined,
    type: "3rdParty",
  },
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      ({
        "nowPlaying.playingFrom": "Playing from",
        "queue.empty": "Queue empty",
        "systemPlaylists.hearted": "Hearted",
        "systemPlaylists.mostPlayed": "Most Played",
        "systemPlaylists.recentlyPlayed": "Recently Played",
        "systemPlaylists.sourceLabel": `Playing from ${vars?.name ?? ""}`,
      })[key] ?? key,
  }),
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSession: () => undefined,
}));

vi.mock("@/components/library/virtual-track-list", () => ({
  VirtualTrackList: ({ tracks }: { tracks: Track[] }) => (
    <div data-count={tracks.length} data-testid="queue-list" />
  ),
}));

describe("QueuePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({
      activeSessionId: null,
      currentIndex: -1,
      queue: [],
      queueSource: undefined,
    } as Partial<ReturnType<typeof usePlayerStore.getState>>);
  });

  it("renders the current playback queue (not a 歌单 picker)", () => {
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_a"), makeTrack("trk_b")],
    } as Partial<ReturnType<typeof usePlayerStore.getState>>);

    render(<QueuePanel />);

    const list = screen.getByTestId("queue-list");
    expect(list).toHaveAttribute("data-count", "2");
    // No pinned system-playlist source buttons live in the queue drawer.
    expect(screen.queryByRole("button", { name: "Hearted" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Most Played" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recently Played" })).not.toBeInTheDocument();
  });

  it("shows the system-playlist source label when playing from one", () => {
    usePlayerStore.setState({
      queueSource: { id: "system:liked", kind: "system-playlist" },
    } as Partial<ReturnType<typeof usePlayerStore.getState>>);

    render(<QueuePanel />);

    expect(screen.getByText("Playing from Hearted")).toBeInTheDocument();
  });

  it("reflects cursor-only changes without replacing the queue list", async () => {
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_a"), makeTrack("trk_b")],
    } as Partial<ReturnType<typeof usePlayerStore.getState>>);

    render(<QueuePanel />);

    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
    });

    expect(screen.getByTestId("queue-list")).toHaveAttribute("data-count", "2");
  });
});

function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
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
    title: id,
    ...overrides,
  };
}
