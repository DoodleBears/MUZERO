import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/db/types";
import { NETEASE_DAILY_PLAYLIST_ID } from "@/streamsrc/virtual-playlists";

// i18n isn't initialized in tests; echo keys so assertions are deterministic.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count != null ? `${key}:${opts.count}` : key,
  }),
}));

let settingsValue: Partial<AppSettings>;
// biome-ignore lint/suspicious/noExplicitAny: minimal react-query result stand-ins
let dailyState: any;
// biome-ignore lint/suspicious/noExplicitAny: minimal react-query result stand-ins
let playlistsState: any;
const setTab = vi.fn();
const setSettingsItem = vi.fn();
const openPlaylist = vi.fn();

vi.mock("@/hooks/use-app-data", () => ({ useSettings: () => settingsValue }));
vi.mock("@/hooks/use-netease-recommend", () => ({
  useNeteaseDailyTracks: () => dailyState,
  useNeteaseRecommendedPlaylists: () => playlistsState,
}));
vi.mock("@/stores/nav-store", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: selector stand-in
  useNavStore: (sel: any) => sel({ setTab, setSettingsItem }),
}));

import { OnlineDiscoverTab } from "./online-discover-tab";

beforeEach(() => {
  vi.clearAllMocks();
  settingsValue = { streamSources: {} };
  dailyState = {
    data: [],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    reroll: vi.fn(),
  };
  playlistsState = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
});

describe("OnlineDiscoverTab", () => {
  it("shows a non-blocking login card while still rendering anonymous playlists", () => {
    playlistsState.data = [{ id: "p1", name: "官方歌单", trackCount: 10, source: "netease" }];
    render(<OnlineDiscoverTab onOpenPlaylist={openPlaylist} />);
    expect(screen.getByText("discover.loginToUnlock")).toBeInTheDocument();
    expect(screen.getByText("官方歌单")).toBeInTheDocument(); // playlists not gated
  });

  it("routes the login card to the Settings streaming section", () => {
    render(<OnlineDiscoverTab onOpenPlaylist={openPlaylist} />);
    fireEvent.click(screen.getByText("discover.loginToUnlock"));
    expect(setSettingsItem).toHaveBeenCalledWith("stream-sources");
    expect(setTab).toHaveBeenCalledWith("settings");
  });

  it("opens daily recommendations as the fixed first playlist card when logged in", () => {
    settingsValue = { streamSources: { netease: { cookie: "MUSIC_U=abc" } } };
    const hit = {
      source: "netease",
      externalId: "1",
      title: "晴天",
      artist: "周杰伦",
      coverUrl: "https://p/song.jpg",
    };
    dailyState.data = [hit];
    playlistsState.data = [{ id: "p1", name: "歌单", trackCount: 3, source: "netease" }];
    render(<OnlineDiscoverTab onOpenPlaylist={openPlaylist} />);
    expect(screen.queryByText("discover.loginToUnlock")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("discover.dailyTracks"));
    expect(openPlaylist).toHaveBeenCalledWith({
      id: NETEASE_DAILY_PLAYLIST_ID,
      name: "discover.dailyTracks",
      source: "netease",
      trackCount: 1,
      coverUrl: "https://p/song.jpg",
    });
  });

  it("opens a recommended playlist detail page from the card", () => {
    const playlist = { id: "p1", name: "歌单", trackCount: 3, source: "netease" };
    playlistsState.data = [playlist];
    render(<OnlineDiscoverTab onOpenPlaylist={openPlaylist} />);
    fireEvent.click(screen.getByText("歌单"));
    expect(openPlaylist).toHaveBeenCalledWith(playlist);
  });

  it("shows a retry affordance when a section errors", () => {
    playlistsState = { ...playlistsState, isError: true };
    render(<OnlineDiscoverTab onOpenPlaylist={openPlaylist} />);
    fireEvent.click(screen.getByText("discover.retry"));
    expect(playlistsState.refetch).toHaveBeenCalled();
  });
});
