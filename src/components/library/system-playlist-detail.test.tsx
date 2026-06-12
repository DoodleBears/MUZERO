import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaybackEvent, Track, TrackPlaybackStats } from "@/db/types";
import { usePlayerStore } from "@/stores/player-store";
import { SystemPlaylistDetail } from "./system-playlist-detail";

const NOW = new Date(2026, 0, 15, 12).getTime();
const DAY = 24 * 60 * 60 * 1000;

const mocks = vi.hoisted(() => ({
  latestTracks: [] as Track[],
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    init: () => undefined,
    type: "3rdParty",
  },
  useTranslation: () => ({
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
        "systemPlaylists.playCount": `${vars?.count ?? 0} plays`,
        "systemPlaylists.playCount_other": `${vars?.count ?? 0} plays`,
        "systemPlaylists.rangeAll": "All",
        "systemPlaylists.rangeDay": "Day",
        "systemPlaylists.rangeMonth": "Month",
        "systemPlaylists.rangeWeek": "Week",
        "systemPlaylists.recentlyPlayed": "Recently Played",
      })[key] ?? key,
  }),
}));

vi.mock("@/components/library/track-list-section", () => ({
  TrackListSection: ({
    getTrackSupplement,
    startActions,
    tracks,
  }: {
    getTrackSupplement?: (track: Track) => React.ReactNode;
    startActions?: React.ReactNode;
    tracks: Track[];
  }) => {
    mocks.latestTracks = tracks;
    return (
      <div data-count={tracks.length} data-testid="track-list-section">
        {tracks.map((item) => (
          <div key={item.id} data-testid={`track-supplement-${item.id}`}>
            {getTrackSupplement?.(item)}
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

  it("renders selected range play count and listen time for local Most Played rows", () => {
    const tracks = [track("trk_week", "Week")];
    render(
      <SystemPlaylistDetail
        events={[event("trk_week", NOW - DAY, { listenedSec: 75 })]}
        now={NOW}
        onBack={vi.fn()}
        playlistId="system:most"
        remoteTracks={[]}
        stats={[stat("trk_week", 9)]}
        tracks={tracks}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    expect(screen.getByTestId("track-supplement-trk_week")).toHaveTextContent(
      "1 plays · 1m listened",
    );
  });

  it("plays all currently visible local tracks as a system playlist", () => {
    const playSystemPlaylist = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ playSystemPlaylist } as Partial<
      ReturnType<typeof usePlayerStore.getState>
    >);
    const tracks = [track("trk_1", "One", { liked: true }), track("trk_2", "Two")];

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

function stat(trackId: string, playCount: number): TrackPlaybackStats {
  return {
    devicePublicId: "dvc_1",
    id: `dvc_1:${trackId}`,
    listenedSec: playCount * 30,
    playCount,
    trackId,
    updatedAt: NOW,
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
