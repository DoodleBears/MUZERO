import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/db/types";
import { NETEASE_DAILY_PLAYLIST_ID } from "@/streamsrc/virtual-playlists";
import { OnlinePlaylistDetail } from "./online-playlist-detail";

const mocks = vi.hoisted(() => ({
  settingsValue: { streamSources: { netease: { cookie: "MUSIC_U=abc" } } },
  provider: {
    getDailyRecommendedTracks: vi.fn(),
    importPlaylist: vi.fn(),
  },
  playOnlinePlaylist: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({
    getTotalSize: () => options.count * 60,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        size: 60,
        start: index * 60,
      })),
  }),
}));

vi.mock("motion/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const Div = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => {
    const { animate, children, initial, transition, ...domProps } = props;
    void animate;
    void initial;
    void transition;
    return React.createElement("div", { ...domProps, ref }, children as ReactNode);
  });
  return { motion: { div: Div } };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count != null ? `${key}:${opts.count}` : key,
  }),
}));

vi.mock("@/components/stream/playlist-import-dialog", () => ({
  PlaylistImportDialog: () => null,
}));

vi.mock("@/components/ui/disc-3", () => ({
  Disc3Icon: () => <span data-testid="disc-icon" />,
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => mocks.settingsValue,
}));

vi.mock("@/hooks/use-back-gesture", () => ({
  useBackGesture: vi.fn(),
}));

vi.mock("@/stores/player-store", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: selector stand-in
  usePlayerStore: (sel: any) =>
    sel({
      playOnlinePlaylist: mocks.playOnlinePlaylist,
    }),
}));

vi.mock("@/streamsrc/registry", () => ({
  createStreamSource: () => mocks.provider,
}));

vi.mock("@/streamsrc/stream-http", () => ({
  createStreamHttp: () => ({}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsValue = {
    streamSources: { netease: { cookie: "MUSIC_U=abc" } },
  } satisfies Partial<AppSettings>;
  mocks.provider.getDailyRecommendedTracks.mockResolvedValue([
    {
      source: "netease",
      externalId: "daily-1",
      title: "Daily Song",
      artist: "Artist",
      coverUrl: "https://p/daily.jpg",
    },
  ]);
  mocks.provider.importPlaylist.mockResolvedValue([
    {
      source: "netease",
      externalId: "track-1",
      title: "Playlist Song",
      artist: "Artist",
    },
  ]);
});

describe("OnlinePlaylistDetail", () => {
  it("loads the fixed daily playlist through the daily recommendations API", async () => {
    render(
      <OnlinePlaylistDetail
        playlist={{
          id: NETEASE_DAILY_PLAYLIST_ID,
          name: "discover.dailyTracks",
          source: "netease",
          trackCount: 30,
        }}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByText("Daily Song")).toBeInTheDocument();
    expect(mocks.provider.getDailyRecommendedTracks).toHaveBeenCalledWith(
      expect.objectContaining({ afresh: false, signal: expect.any(AbortSignal) }),
    );
    expect(mocks.provider.importPlaylist).not.toHaveBeenCalled();
    expect(screen.queryByText("streamSources.import")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("discover.reroll"));

    await waitFor(() => expect(mocks.provider.getDailyRecommendedTracks).toHaveBeenCalledTimes(2));
    expect(mocks.provider.getDailyRecommendedTracks.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ afresh: true, signal: expect.any(AbortSignal) }),
    );
  });

  it("loads regular online playlists through importPlaylist", async () => {
    render(
      <OnlinePlaylistDetail
        playlist={{ id: "p1", name: "Playlist", source: "netease", trackCount: 1 }}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByText("Playlist Song")).toBeInTheDocument();
    expect(mocks.provider.importPlaylist).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.provider.getDailyRecommendedTracks).not.toHaveBeenCalled();
    expect(screen.getByText("streamSources.import")).toBeInTheDocument();
  });

  it("plays a clicked row + 'play all' in the online-playlist context", async () => {
    const playlist = { id: "p1", name: "Playlist", source: "netease", trackCount: 1 } as const;
    render(<OnlinePlaylistDetail playlist={playlist} onBack={vi.fn()} />);

    const row = await screen.findByText("Playlist Song");
    fireEvent.click(row);
    // The whole playlist (its hits) becomes the context; the clicked hit is index 0.
    expect(mocks.playOnlinePlaylist).toHaveBeenCalledWith(
      playlist,
      [expect.objectContaining({ externalId: "track-1", title: "Playlist Song" })],
      0,
    );

    mocks.playOnlinePlaylist.mockClear();
    fireEvent.click(screen.getByText("gallery.playAll"));
    expect(mocks.playOnlinePlaylist).toHaveBeenCalledWith(
      playlist,
      [expect.objectContaining({ externalId: "track-1" })],
      0,
    );
  });
});
