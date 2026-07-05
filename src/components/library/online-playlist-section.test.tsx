import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OnlinePlaylistCatalogEntry } from "@/db/types";
import { OnlinePlaylistSection } from "./online-playlist-section";

const playlists: OnlinePlaylistCatalogEntry[] = [
  { source: "netease", id: "n1", name: "只熊喜欢的音乐", trackCount: 6083 },
  { source: "bili", id: "b1", name: "动画收藏", trackCount: 12 },
  { source: "qq", id: "q1", name: "夜跑", trackCount: 7 },
];

describe("OnlinePlaylistSection", () => {
  it("renders online playlists and opens a playlist", () => {
    const onOpen = vi.fn();
    render(
      <OnlinePlaylistSection
        playlists={playlists}
        query=""
        onOpen={onOpen}
        onImport={vi.fn()}
        onRefresh={vi.fn()}
        view="grid"
      />,
    );

    expect(screen.getByText("只熊喜欢的音乐")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "只熊喜欢的音乐" }));
    expect(onOpen).toHaveBeenCalledWith(playlists[0]);
  });

  it("filters by text query", () => {
    const { rerender } = render(
      <OnlinePlaylistSection
        playlists={playlists}
        query="动画"
        onOpen={vi.fn()}
        onImport={vi.fn()}
        onRefresh={vi.fn()}
        view="list"
      />,
    );

    expect(screen.getByText("动画收藏")).toBeInTheDocument();
    expect(screen.queryByText("只熊喜欢的音乐")).not.toBeInTheDocument();

    rerender(
      <OnlinePlaylistSection
        playlists={playlists}
        query="喜欢"
        onOpen={vi.fn()}
        onImport={vi.fn()}
        onRefresh={vi.fn()}
        view="list"
      />,
    );

    expect(screen.getByText("只熊喜欢的音乐")).toBeInTheDocument();
    expect(screen.queryByText("动画收藏")).not.toBeInTheDocument();
  });

  it("imports without opening the playlist", () => {
    const onOpen = vi.fn();
    const onImport = vi.fn();
    render(
      <OnlinePlaylistSection
        playlists={playlists}
        query=""
        onOpen={onOpen}
        onImport={onImport}
        onRefresh={vi.fn()}
        view="grid"
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "streamSources.import" })[0]);
    expect(onImport).toHaveBeenCalledWith(playlists[0]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("uses a bounded virtual scroller for large inline online playlist sections", async () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      source: "netease" as const,
      id: `n${index}`,
      name: `Playlist ${index}`,
      trackCount: index,
    }));

    render(
      <OnlinePlaylistSection
        playlists={many}
        query=""
        onOpen={vi.fn()}
        onImport={vi.fn()}
        onRefresh={vi.fn()}
        view="grid"
      />,
    );

    expect(await screen.findByTestId("online-playlist-inline-virtual-scroll")).toBeInTheDocument();
  });
});
