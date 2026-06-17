import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaybackEvent, Track, TrackPlaybackStats } from "@/db/types";
import { usePlayerStore } from "@/stores/player-store";
import { SystemPlaylistDetail } from "./system-playlist-detail";

const NOW = new Date(2026, 0, 15, 12).getTime();
const DAY = 24 * 60 * 60 * 1000;

const mocks = vi.hoisted(() => ({
  latestTracks: [] as Track[],
  likedIds: new Set<string>(),
}));

// `liked` lives in the trackLikes side table now; drive the hook from the test.
vi.mock("@/hooks/use-liked-tracks", () => ({
  useLikedTrackIds: () => mocks.likedIds,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    init: () => undefined,
    type: "3rdParty",
  },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, vars?: Record<string, unknown>) =>
      ({
        "gallery.back": "Back",
        "gallery.count": `${vars?.count ?? 0} songs`,
        "gallery.playAll": "Play all",
        "player.play": "Play",
        "systemPlaylists.emptyHearted": "No hearted songs",
        "systemPlaylists.emptyMostPlayed": "No most played songs",
        "systemPlaylists.emptyRecentlyPlayed": "No recently played songs",
        "systemPlaylists.hearted": "Hearted",
        "systemPlaylists.mostPlayed": "Most Played",
        "systemPlaylists.listenTime": `${vars?.time ?? ""} listened`,
        "systemPlaylists.lastPlayedColumn": "Last played",
        "systemPlaylists.neverPlayed": "Never",
        "systemPlaylists.playCount": `${vars?.count ?? 0} plays`,
        "systemPlaylists.playCountColumn": "Plays",
        "systemPlaylists.playCount_other": `${vars?.count ?? 0} plays`,
        "systemPlaylists.rangeAll": "All",
        "systemPlaylists.rangeDay": "Day",
        "systemPlaylists.rangeMonth": "Month",
        "systemPlaylists.rangeWeek": "Week",
        "systemPlaylists.recentlyPlayed": "Recently Played",
        "systemPlaylists.sortDefault": "Default",
        "systemPlaylists.sortLastPlayed": "Last played",
        "systemPlaylists.sortPlayCount": "Play count",
      })[key] ?? key,
  }),
}));

vi.mock("@/hooks/use-shortcut-matcher", () => ({
  useShortcutMatcher: () => (event: KeyboardEvent, actionId: string) =>
    actionId === "library.back" && (event.code === "KeyA" || event.code === "ArrowLeft"),
}));

vi.mock("@/components/library/track-list-section", () => ({
  TrackListSection: ({
    afterToolbar,
    endActions,
    getTrackColumns,
    startActions,
    tracks,
  }: {
    afterToolbar?: React.ReactNode;
    endActions?: React.ReactNode;
    getTrackColumns?: (track: Track) => React.ReactNode;
    startActions?: React.ReactNode;
    tracks: Track[];
  }) => {
    mocks.latestTracks = tracks;
    return (
      <div data-count={tracks.length} data-testid="track-list-section">
        {endActions}
        {afterToolbar}
        {tracks.map((item) => (
          <div key={item.id} data-testid={`track-columns-${item.id}`}>
            {getTrackColumns?.(item)}
          </div>
        ))}
        {startActions}
      </div>
    );
  },
}));

vi.mock("@/components/track/track-inspector-panel", () => ({
  TrackInspectorPanel: ({ track }: { track?: Track }) => (
    <div data-track-id={track?.id ?? ""} data-testid="track-inspector-panel" />
  ),
}));

describe("SystemPlaylistDetail", () => {
  beforeEach(() => {
    mocks.latestTracks = [];
    mocks.likedIds = new Set();
    usePlayerStore.setState({
      play: vi.fn(),
      playSystemPlaylist: vi.fn().mockResolvedValue(undefined),
    } as Partial<ReturnType<typeof usePlayerStore.getState>>);
  });

  it("switches Most Played ranges before feeding the virtual list", () => {
    const tracks = [track("trk_all", "All-time"), track("trk_week", "Week")];
    render(
      <SystemPlaylistDetail
        events={[event("trk_week", NOW - DAY)]}
        now={NOW}
        onBack={vi.fn()}
        playlistId="system:most"
        remoteTracks={[]}
        stats={[stat("trk_all", 5), stat("trk_week", 1)]}
        tracks={tracks}
      />,
    );

    expect(mocks.latestTracks.map((item) => item.id)).toEqual(["trk_all", "trk_week"]);

    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    expect(mocks.latestTracks.map((item) => item.id)).toEqual(["trk_week"]);
  });

  it("renders play count and last played as separate local row columns", () => {
    const tracks = [track("trk_week", "Week"), track("trk_today", "Today")];
    render(
      <SystemPlaylistDetail
        events={[]}
        now={NOW}
        onBack={vi.fn()}
        playlistId="system:most"
        remoteTracks={[]}
        stats={[
          stat("trk_week", 9, { lastPlayedAt: NOW - DAY }),
          stat("trk_today", 2, { lastPlayedAt: NOW - 2 * 60 * 60 * 1000 }),
        ]}
        tracks={tracks}
      />,
    );

    expect(screen.getByText("Plays")).toBeInTheDocument();
    expect(screen.getAllByText("Last played")).toHaveLength(2);
    expect(screen.getByTestId("track-columns-trk_week")).toHaveTextContent("9");
    expect(screen.getByTestId("track-columns-trk_week")).toHaveTextContent("26/01/14");
    expect(screen.getByTestId("track-columns-trk_today")).toHaveTextContent("2");
    expect(screen.getByTestId("track-columns-trk_today")).toHaveTextContent("10:00");
  });

  it("plays the queue in the selected system sort order", () => {
    const playSystemPlaylist = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ playSystemPlaylist } as Partial<
      ReturnType<typeof usePlayerStore.getState>
    >);
    const recentLow = track("trk_recent_low", "Recent low");
    const oldHigh = track("trk_old_high", "Old high");

    render(
      <SystemPlaylistDetail
        events={[]}
        now={NOW}
        onBack={vi.fn()}
        playlistId="system:most"
        remoteTracks={[]}
        stats={[
          stat("trk_recent_low", 1, { lastPlayedAt: NOW - 1_000 }),
          stat("trk_old_high", 5, { lastPlayedAt: NOW - DAY }),
        ]}
        tracks={[recentLow, oldHigh]}
      />,
    );

    expect(mocks.latestTracks.map((item) => item.id)).toEqual(["trk_old_high", "trk_recent_low"]);

    fireEvent.click(screen.getByRole("button", { name: "Last played" }));
    expect(mocks.latestTracks.map((item) => item.id)).toEqual(["trk_recent_low", "trk_old_high"]);

    fireEvent.click(screen.getByRole("button", { name: "Play all" }));

    expect(playSystemPlaylist).toHaveBeenCalledWith("system:most", [recentLow, oldHigh]);
  });

  it("plays all currently visible local tracks as a system playlist", () => {
    const playSystemPlaylist = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ playSystemPlaylist } as Partial<
      ReturnType<typeof usePlayerStore.getState>
    >);
    const tracks = [track("trk_1", "One", { liked: true }), track("trk_2", "Two")];
    mocks.likedIds = new Set(["trk_1"]);

    render(
      <SystemPlaylistDetail
        events={[]}
        now={NOW}
        onBack={vi.fn()}
        playlistId="system:liked"
        remoteTracks={[]}
        stats={[]}
        tracks={tracks}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play all" }));

    expect(playSystemPlaylist).toHaveBeenCalledWith("system:liked", [tracks[0]]);
  });

  it("hides playback stats and metric sorting on the hearted playlist", () => {
    const tracks = [track("trk_1", "One", { liked: true })];
    mocks.likedIds = new Set(["trk_1"]);

    render(
      <SystemPlaylistDetail
        events={[]}
        now={NOW}
        onBack={vi.fn()}
        playlistId="system:liked"
        remoteTracks={[]}
        stats={[stat("trk_1", 8, { lastPlayedAt: NOW - 1_000 })]}
        tracks={tracks}
      />,
    );

    expect(screen.queryByText("Plays")).not.toBeInTheDocument();
    expect(screen.queryByText("Last played")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play count" })).not.toBeInTheDocument();
    expect(screen.getByTestId("track-columns-trk_1")).toBeEmptyDOMElement();
  });

  it("goes back from system playlist detail with the library back shortcut", () => {
    const onBack = vi.fn();

    render(
      <SystemPlaylistDetail
        events={[]}
        now={NOW}
        onBack={onBack}
        playlistId="system:recent"
        remoteTracks={[]}
        stats={[stat("trk_1", 1, { lastPlayedAt: NOW })]}
        tracks={[track("trk_1", "One")]}
      />,
    );

    fireEvent.keyDown(window, { code: "KeyA", key: "a" });

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

function track(id: string, title: string, patch: Partial<Track> = {}): Track {
  return {
    createdAt: NOW - 10_000,
    durationSec: 180,
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
    ...patch,
  };
}

function stat(
  trackId: string,
  playCount: number,
  patch: Partial<TrackPlaybackStats> = {},
): TrackPlaybackStats {
  return {
    devicePublicId: "dvc_1",
    id: `dvc_1:${trackId}`,
    listenedSec: playCount * 30,
    playCount,
    trackId,
    updatedAt: NOW,
    ...patch,
  };
}

function event(
  trackId: string,
  startedAt: number,
  patch: Partial<PlaybackEvent> = {},
): PlaybackEvent {
  return {
    context: { source: "local" },
    countedAsPlay: true,
    devicePublicId: "dvc_1",
    id: `ple_${trackId}_${startedAt}`,
    listenedSec: 30,
    startedAt,
    trackId,
    ...patch,
  };
}
