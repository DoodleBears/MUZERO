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
const playStreamedHit = vi.fn();
const playStreamedHits = vi.fn();

vi.mock("@/hooks/use-app-data", () => ({ useSettings: () => settingsValue }));
vi.mock("@/hooks/use-netease-recommend", () => ({
  useNeteaseDailyTracks: () => dailyState,
  useNeteaseRecommendedPlaylists: () => playlistsState,
}));
vi.mock("@/stores/nav-store", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: selector stand-in
  useNavStore: (sel: any) => sel({ setTab, setSettingsItem }),
}));
vi.mock("@/stores/player-store", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: selector stand-in
  usePlayerStore: (sel: any) => sel({ playStreamedHit, playStreamedHits }),
}));
// Stub the heavy import dialog (it pulls the player store + sessions) — we only need
// to confirm a card opens it with the right playlist.
vi.mock("@/components/stream/playlist-import-dialog", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: stub props
  PlaylistImportDialog: ({ playlist }: any) =>
    playlist ? <div data-testid="import-dialog">{`dialog:${playlist.id}`}</div> : null,
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
  it("shows a non-blocking login chip while still rendering anonymous playlists", () => {
    playlistsState.data = [{ id: "p1", name: "官方歌单", trackCount: 10, source: "netease" }];
    render(<OnlineDiscoverTab />);
    expect(screen.getByText("discover.loginToUnlock")).toBeInTheDocument();
    expect(screen.getByText("官方歌单")).toBeInTheDocument(); // playlists not gated
  });

  it("routes the login chip to the Settings streaming section", () => {
    render(<OnlineDiscoverTab />);
    fireEvent.click(screen.getByText("discover.loginToUnlock"));
    expect(setSettingsItem).toHaveBeenCalledWith("stream-sources");
    expect(setTab).toHaveBeenCalledWith("settings");
  });

  it("plays a daily song into the online set on row click (logged in)", () => {
    settingsValue = { streamSources: { netease: { cookie: "MUSIC_U=abc" } } };
    const hit = { source: "netease", externalId: "1", title: "晴天", artist: "周杰伦" };
    dailyState.data = [hit];
    render(<OnlineDiscoverTab />);
    expect(screen.queryByText("discover.loginToUnlock")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("晴天"));
    expect(playStreamedHit).toHaveBeenCalledWith(hit);
  });

  it("plays the whole daily list via 'play all' and rerolls with afresh", () => {
    settingsValue = { streamSources: { netease: { cookie: "MUSIC_U=abc" } } };
    dailyState.data = [
      { source: "netease", externalId: "1", title: "A" },
      { source: "netease", externalId: "2", title: "B" },
    ];
    render(<OnlineDiscoverTab />);
    fireEvent.click(screen.getByText("discover.playAll"));
    expect(playStreamedHits).toHaveBeenCalledWith(dailyState.data);
    fireEvent.click(screen.getByText("discover.reroll"));
    expect(dailyState.reroll).toHaveBeenCalled();
  });

  it("opens the import dialog for a recommended playlist card", () => {
    playlistsState.data = [{ id: "p1", name: "歌单", trackCount: 3, source: "netease" }];
    render(<OnlineDiscoverTab />);
    expect(screen.queryByTestId("import-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("歌单"));
    expect(screen.getByTestId("import-dialog")).toHaveTextContent("dialog:p1");
  });

  it("shows a retry affordance when a section errors", () => {
    settingsValue = { streamSources: { netease: { cookie: "MUSIC_U=abc" } } };
    dailyState = { ...dailyState, isError: true };
    render(<OnlineDiscoverTab />);
    fireEvent.click(screen.getByText("discover.retry"));
    expect(dailyState.refetch).toHaveBeenCalled();
  });
});
