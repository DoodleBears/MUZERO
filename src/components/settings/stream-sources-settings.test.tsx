import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DjSession } from "@/db/types";
import type { StreamPlaylist } from "@/streamsrc/provider";
import { SourcePlaylistList } from "./stream-sources-settings";

const playlists: StreamPlaylist[] = [
  { source: "netease", id: "n1", name: "只熊喜欢的音乐", trackCount: 6083 },
  { source: "netease", id: "n2", name: "夜间电音", trackCount: 7 },
  { source: "netease", id: "n3", name: "工作 BGM", trackCount: 16 },
];

describe("SourcePlaylistList", () => {
  it("renders a bounded scroll list with a filter", () => {
    const { container } = render(
      <SourcePlaylistList
        playlists={playlists}
        sessions={[]}
        onOpen={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(screen.getByRole("searchbox")).toHaveAttribute("placeholder", "Filter playlists…");
    expect(container.querySelector("[data-stream-playlist-scroll]")).toHaveClass(
      "max-h-[min(42vh,420px)]",
      "overflow-y-auto",
      "thin-transparent-scrollbar",
    );
  });

  it("filters playlists by name", () => {
    render(
      <SourcePlaylistList
        playlists={playlists}
        sessions={[]}
        onOpen={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "电音" } });
    expect(screen.getByText("夜间电音")).toBeInTheDocument();
    expect(screen.queryByText("只熊喜欢的音乐")).not.toBeInTheDocument();
  });

  it("opens and imports playlists without mixing the actions", () => {
    const onOpen = vi.fn();
    const onImport = vi.fn();
    render(
      <SourcePlaylistList
        playlists={playlists}
        sessions={[]}
        onOpen={onOpen}
        onImport={onImport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /只熊喜欢的音乐/ }));
    expect(onOpen).toHaveBeenCalledWith(playlists[0]);

    fireEvent.click(screen.getAllByRole("button", { name: "Import" })[0]);
    expect(onImport).toHaveBeenCalledWith(playlists[0]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("passes matched synced sets to playlist sync controls", () => {
    const session = {
      id: "ses_1",
      streamPlaylistRef: { source: "netease", id: "n1" },
    } as DjSession;
    const { container } = render(
      <SourcePlaylistList
        playlists={playlists}
        sessions={[session]}
        onOpen={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("只熊喜欢的音乐");
  });
});
