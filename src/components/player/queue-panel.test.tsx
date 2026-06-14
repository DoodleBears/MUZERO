import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/muzero-db";
import { listAllTracks, listTrackPlaybackStats } from "@/db/repositories";
import type { Track } from "@/db/types";
import { clearTrace, getTraceEntries } from "@/lib/trace";
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
  useLiveQuery: (query: () => unknown, _deps: unknown[], defaultValue: unknown) => {
    void query();
    return defaultValue;
  },
}));

vi.mock("@/db/muzero-db", () => ({
  db: {
    playbackEvents: {
      toArray: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/db/repositories", () => ({
  listAllTracks: vi.fn().mockResolvedValue([]),
  listTrackPlaybackStats: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/components/library/virtual-track-list", () => ({
  VirtualTrackList: ({ tracks }: { tracks: Track[] }) => (
    <div data-count={tracks.length} data-testid="queue-list" />
  ),
}));

describe("QueuePanel system playlist sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTrace();
    vi.mocked(db.playbackEvents.toArray).mockClear();
    vi.mocked(db.playbackEvents.toArray).mockResolvedValue([]);
    vi.mocked(listAllTracks).mockResolvedValue([]);
    vi.mocked(listTrackPlaybackStats).mockResolvedValue([]);
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

  it("does not read full-library system playlist data while rendering or switching cursor", async () => {
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_a"), makeTrack("trk_b")],
    } as Partial<ReturnType<typeof usePlayerStore.getState>>);

    render(<QueuePanel />);

    expect(listAllTracks).not.toHaveBeenCalled();
    expect(listTrackPlaybackStats).not.toHaveBeenCalled();
    expect(db.playbackEvents.toArray).not.toHaveBeenCalled();

    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
    });

    expect(listAllTracks).not.toHaveBeenCalled();
    expect(listTrackPlaybackStats).not.toHaveBeenCalled();
    expect(db.playbackEvents.toArray).not.toHaveBeenCalled();
  });

  it("loads a system playlist source without requiring a DjSession", async () => {
    const playSystemPlaylist = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({
      playSystemPlaylist,
      queueSource: { id: "system:liked", kind: "system-playlist" },
    } as Partial<ReturnType<typeof usePlayerStore.getState>>);

    render(<QueuePanel />);

    expect(screen.getByText("Playing from Hearted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Most Played" }));

    await vi.waitFor(() => expect(playSystemPlaylist).toHaveBeenCalledWith("system:most", []));
  });

  it("records a trace row when a pinned system playlist is derived", async () => {
    const playSystemPlaylist = vi.fn().mockResolvedValue(undefined);
    vi.mocked(listAllTracks).mockResolvedValue([makeTrack("trk_a")]);
    usePlayerStore.setState({
      playSystemPlaylist,
    } as Partial<ReturnType<typeof usePlayerStore.getState>>);

    render(<QueuePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Most Played" }));

    await vi.waitFor(() => expect(playSystemPlaylist).toHaveBeenCalled());
    expect(getTraceEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "derive",
          scope: "queuePanel.systemPlaylist",
          context: expect.objectContaining({
            category: "performance",
            phase: "success",
            playlistId: "system:most",
            tracks: 1,
          }),
        }),
      ]),
    );
  });

  it("does not read playback stats or events when opening the hearted playlist", async () => {
    const playSystemPlaylist = vi.fn().mockResolvedValue(undefined);
    vi.mocked(listAllTracks).mockResolvedValue([makeTrack("trk_liked", { liked: true })]);
    usePlayerStore.setState({
      playSystemPlaylist,
    } as Partial<ReturnType<typeof usePlayerStore.getState>>);

    render(<QueuePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Hearted" }));

    await vi.waitFor(() =>
      expect(playSystemPlaylist).toHaveBeenCalledWith("system:liked", [
        expect.objectContaining({ id: "trk_liked" }),
      ]),
    );
    expect(listTrackPlaybackStats).not.toHaveBeenCalled();
    expect(db.playbackEvents.toArray).not.toHaveBeenCalled();
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
