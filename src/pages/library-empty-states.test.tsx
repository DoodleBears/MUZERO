import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NowPlayingPage } from "@/pages/now-playing-page";
import { SearchPage } from "@/pages/search-page";
import { usePlayerStore } from "@/stores/player-store";

vi.mock("react-i18next", () => ({
  initReactI18next: {
    init: () => undefined,
    type: "3rdParty",
  },
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      ({
        "displayMode.cover": "Cover",
        "displayMode.video": "Video",
        "dock.lyrics": "Lyrics",
        "dock.memory": "Memory",
        "dock.playlist": "Playlist",
        "drop.addSubtitle": "Audio & video become tracks — drop anywhere on screen",
        "folderImport.chooseFiles": "Choose files",
        "folderImport.chooseFolder": "Choose folder",
        "folderImport.linkLocalFolder": "Link local folder",
        "gallery.addTracks": "Add tracks",
        "gallery.modeAlbums": "Albums",
        "gallery.modeArtists": "Artists",
        "gallery.modeSets": "Sets",
        "gallery.modeTracks": "All songs",
        "gallery.count": `${vars?.count ?? 0} songs`,
        "gallery.searchAlbums": "Search albums…",
        "gallery.searchArtists": "Search artists…",
        "gallery.searchSets": "Search sets…",
        "gallery.searchTracks": "Search all songs…",
        "gallery.tracksEmpty": "No songs yet — upload media or start a DJ set.",
        "nowPlaying.closeQueue": "Close queue",
        "nowPlaying.empty": "Nothing here yet — start a set and the DJ will fill it.",
        "nowPlaying.lyrics": "Lyrics",
        "nowPlaying.modeTitle": "Mode: {{mode}}",
        "nowPlaying.playingFrom": "Playing from",
        "nowPlaying.repeat": "Repeat",
        "nowPlaying.shuffle": "Shuffle",
        "nowPlaying.upNext": "Up next",
        "player.next": "Next",
        "player.previous": "Previous",
        "sessions.startDjSet": "Start DJ set",
        "sessions.uploadDesc": "Add your own audio or video files.",
        "sessions.uploadTitle": "Make a video / upload set",
        "systemPlaylists.hearted": "Hearted",
        "systemPlaylists.mostPlayed": "Most Played",
        "systemPlaylists.play": `Play ${vars?.name ?? ""}`,
        "systemPlaylists.recentlyPlayed": "Recently Played",
      })[key] ?? key,
  }),
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (_query: () => unknown, _deps: unknown[], defaultValue: unknown) => defaultValue,
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({
    coverCropped: true,
    nowPlayingRightRailCollapsed: false,
  }),
}));

vi.mock("@/hooks/use-back-gesture", () => ({
  useBackGesture: () => undefined,
}));

vi.mock("@/hooks/use-media", () => ({
  useCoverMetadataBackfill: () => undefined,
  useTrackCoverResource: () => ({
    readyForTrack: true,
    staleWhilePending: false,
    targetKey: null,
    url: null,
    urlKey: null,
  }),
  useTrackCoverUrl: () => null,
  useTrackThumbnailUrl: () => null,
  useGridCoverUrl: () => null,
  proxyExternalCover: (url: string | undefined) => url ?? null,
}));

vi.mock("@/hooks/use-shortcut-matcher", () => ({
  useShortcutMatcher: () => () => false,
}));

vi.mock("@/hooks/use-transliteration-ready", () => ({
  useTransliterationReady: () => true,
}));

vi.mock("@/lib/smooth-scroll/use-smooth-scroll", () => ({
  lenisScrollTo: () => false,
  useSmoothScroll: () => ({ lenisRef: { current: null } }),
}));

vi.mock("@/components/player/swipeable-media-stage", () => ({
  SwipeableMediaStage: () => <div data-testid="swipeable-media-stage" />,
}));

vi.mock("@/components/player/track-info-card", () => ({
  TrackInfoCard: () => <div data-testid="track-info-card" />,
}));

vi.mock("@/components/player/playback-spectrum", () => ({
  PlaybackSpectrum: () => <div data-testid="playback-spectrum" />,
}));

vi.mock("@/components/player/transport-controls", () => ({
  TransportControls: () => <div data-testid="transport-controls" />,
}));

vi.mock("@/components/player/now-playing-panel", () => ({
  NowPlayingPanel: () => <div data-testid="now-playing-panel" />,
}));

vi.mock("@/components/player/synced-lyrics-view", () => ({
  SyncedLyricsView: () => <div data-testid="synced-lyrics-view" />,
}));

vi.mock("@/components/player/listening-now-section", () => ({
  ListeningNowSection: () => <div data-testid="listening-now-section" />,
}));

vi.mock("@/components/dj/dj-console", () => ({
  DjConsole: () => <div data-testid="dj-console" />,
}));

vi.mock("@/components/track/annotation-editor", () => ({
  AnnotationEditor: () => <div data-testid="annotation-editor" />,
}));

vi.mock("@/components/upload/add-tracks-menu", () => ({
  AddTracksMenu: () => <button type="button">Add tracks</button>,
}));

describe("empty-library onboarding", () => {
  beforeEach(() => {
    localStorage.clear();
    HTMLElement.prototype.scrollTo = vi.fn();
    usePlayerStore.setState({
      activeSessionId: undefined,
      currentIndex: -1,
      djEnabled: false,
      queue: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the import panel in the Songs tab when the whole library is empty", () => {
    localStorage.setItem("muzero-gallery-mode", "tracks");

    render(<SearchPage />);

    expect(screen.getByTestId("library-import-empty-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose files" })).toBeInTheDocument();
    expect(screen.getByText("Make a video / upload set")).toBeInTheDocument();
  });

  it("keeps non-deletable system playlists pinned in an empty Sets wall", () => {
    localStorage.setItem("muzero-gallery-mode", "sets");

    render(<SearchPage />);

    expect(screen.getByRole("button", { name: "Hearted" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recently Played" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Most Played" })).toBeInTheDocument();
    expect(screen.getByTestId("library-import-empty-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose files" })).toBeInTheDocument();
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
  });

  it.each([
    ["albums"],
    ["artists"],
  ])("shows the shared import panel in an empty %s wall", (mode) => {
    localStorage.setItem("muzero-gallery-mode", mode);

    render(<SearchPage />);

    expect(screen.getByTestId("library-import-empty-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose files" })).toBeInTheDocument();
  });

  it("shows an import panel on Now Playing when no track exists anywhere", () => {
    render(<NowPlayingPage />);

    expect(screen.getByTestId("now-playing-empty-library")).toBeInTheDocument();
    expect(screen.getByTestId("library-import-empty-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add tracks" })).toBeInTheDocument();
  });
});
