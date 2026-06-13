import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/db/types";

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
  dailyState = { data: [], isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
  playlistsState = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
});

describe("OnlineDiscoverTab", () => {
  it("shows a non-blocking login chip while still rendering anonymous playlists", () => {
    playlistsState.data = [{ id: "p1", name: "官方歌单", trackCount: 10, source: "netease" }];
    render(<OnlineDiscoverTab />);
    // Logged out: login chip for the daily section, but the playlist grid is NOT empty.
    expect(screen.getByText("discover.loginToUnlock")).toBeInTheDocument();
    expect(screen.getByText("官方歌单")).toBeInTheDocument();
  });

  it("routes the login chip to the Settings streaming section", () => {
    render(<OnlineDiscoverTab />);
    fireEvent.click(screen.getByText("discover.loginToUnlock"));
    expect(setSettingsItem).toHaveBeenCalledWith("stream-sources");
    expect(setTab).toHaveBeenCalledWith("settings");
  });

  it("renders daily tracks (no login chip) once logged in", () => {
    settingsValue = { streamSources: { netease: { cookie: "MUSIC_U=abc" } } };
    dailyState.data = [{ source: "netease", externalId: "1", title: "晴天", artist: "周杰伦" }];
    render(<OnlineDiscoverTab />);
    expect(screen.getByText("晴天")).toBeInTheDocument();
    expect(screen.queryByText("discover.loginToUnlock")).not.toBeInTheDocument();
  });

  it("shows a retry affordance when a section errors", () => {
    settingsValue = { streamSources: { netease: { cookie: "MUSIC_U=abc" } } };
    dailyState = { ...dailyState, isError: true };
    render(<OnlineDiscoverTab />);
    fireEvent.click(screen.getByText("discover.retry"));
    expect(dailyState.refetch).toHaveBeenCalled();
  });

  it("wires per-row play and per-card open when handlers are provided", () => {
    settingsValue = { streamSources: { netease: { cookie: "MUSIC_U=abc" } } };
    dailyState.data = [{ source: "netease", externalId: "1", title: "晴天" }];
    playlistsState.data = [{ id: "p1", name: "歌单", trackCount: 3, source: "netease" }];
    const onPlayTrack = vi.fn();
    const onOpenPlaylist = vi.fn();
    render(<OnlineDiscoverTab onPlayTrack={onPlayTrack} onOpenPlaylist={onOpenPlaylist} />);
    fireEvent.click(screen.getByText("晴天"));
    fireEvent.click(screen.getByText("歌单"));
    expect(onPlayTrack).toHaveBeenCalledWith({ source: "netease", externalId: "1", title: "晴天" });
    expect(onOpenPlaylist).toHaveBeenCalledWith({
      id: "p1",
      name: "歌单",
      trackCount: 3,
      source: "netease",
    });
  });
});
