import { fireEvent, render, screen } from "@testing-library/react";
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
        "player.play": "Play",
        "queue.empty": "Queue empty",
        "systemPlaylists.hearted": "Hearted",
        "systemPlaylists.mostPlayed": "Most Played",
        "systemPlaylists.pinnedSources": "Playlists",
        "systemPlaylists.recentlyPlayed": "Recently Played",
        "systemPlaylists.sourceLabel": `Playing from ${vars?.name ?? ""}`,
      })[key] ?? key,
  }),
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSession: () => undefined,
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (_query: () => unknown, _deps: unknown[], defaultValue: unknown) => defaultValue,
}));

vi.mock("@/db/muzero-db", () => ({
  db: {
    playbackEvents: {
      toArray: vi.fn(),
    },
  },
}));

vi.mock("@/db/repositories", () => ({
  listAllTracks: vi.fn(),
  listTrackPlaybackStats: vi.fn(),
}));

vi.mock("@/components/library/virtual-track-list", () => ({
  VirtualTrackList: ({ tracks }: { tracks: Track[] }) => (
    <div data-count={tracks.length} data-testid="queue-list" />
  ),
}));

describe("QueuePanel system playlist sources", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      activeSessionId: null,
      currentIndex: -1,
      queue: [],
      queueSource: undefined,
      play: vi.fn(),
      playSystemPlaylist: vi.fn().mockResolvedValue(undefined),
    } as Partial<ReturnType<typeof usePlayerStore.getState>>);
  });

  it("renders the three pinned system playlists", () => {
    render(<QueuePanel />);

    expect(screen.getByText("Playlists")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hearted" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recently Played" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Most Played" })).toBeInTheDocument();
  });

  it("loads a system playlist source without requiring a DjSession", () => {
    const playSystemPlaylist = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({
      playSystemPlaylist,
      queueSource: { id: "system:liked", kind: "system-playlist" },
    } as Partial<ReturnType<typeof usePlayerStore.getState>>);

    render(<QueuePanel />);

    expect(screen.getByText("Playing from Hearted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Most Played" }));

    expect(playSystemPlaylist).toHaveBeenCalledWith("system:most", []);
  });
});
