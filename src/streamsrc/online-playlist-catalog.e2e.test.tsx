import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnlinePlaylistSection } from "@/components/library/online-playlist-section";
import { SourcePlaylistList } from "@/components/settings/stream-sources-settings";
import type { AppSettings } from "@/db/types";
import {
  allOnlinePlaylistCatalogEntries,
  syncOnlinePlaylistCatalogSource,
} from "./playlist-catalog";
import type { StreamPlaylist, StreamSourceProvider } from "./provider";

const providerPlaylists: StreamPlaylist[] = [
  { source: "netease", id: "n1", name: "只熊喜欢的音乐", trackCount: 6083 },
  { source: "netease", id: "n2", name: "夜间电音", trackCount: 7 },
];

function fakeProvider(): StreamSourceProvider {
  return {
    id: "netease",
    label: "网易云",
    requiresLogin: true,
    isAuthed: () => true,
    search: vi.fn(),
    resolve: vi.fn(),
    getUserPlaylists: vi.fn(async () => providerPlaylists),
    importPlaylist: vi.fn(),
  };
}

describe("online playlist catalog E2E harness", () => {
  it("syncs metadata once and feeds both Library and Settings playlist surfaces", async () => {
    let settings = {
      id: "app",
      streamSources: {
        netease: { enabled: true, cookie: "MUSIC_U=ok" },
      },
    } as AppSettings;
    const provider = fakeProvider();
    const save = vi.fn(async (patch: Partial<AppSettings>) => {
      settings = { ...settings, ...patch };
      return settings;
    });

    await syncOnlinePlaylistCatalogSource("netease", {
      settings,
      now: () => 1000,
      save,
      createSource: () => provider,
    });

    expect(provider.getUserPlaylists).toHaveBeenCalledOnce();
    expect(provider.importPlaylist).not.toHaveBeenCalled();

    const catalogRows = allOnlinePlaylistCatalogEntries(settings.onlinePlaylistCatalog);
    expect(catalogRows).toHaveLength(2);

    const openFromLibrary = vi.fn();
    const importFromLibrary = vi.fn();
    const libraryRender = render(
      <OnlinePlaylistSection
        playlists={catalogRows}
        query="喜欢"
        onOpen={openFromLibrary}
        onImport={importFromLibrary}
        onRefresh={vi.fn()}
        view="list"
      />,
    );
    expect(screen.getByText("只熊喜欢的音乐")).toBeInTheDocument();
    expect(screen.queryByText("夜间电音")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "只熊喜欢的音乐" }));
    expect(openFromLibrary).toHaveBeenCalledWith(catalogRows[0]);
    libraryRender.unmount();

    const openFromSettings = vi.fn();
    const importFromSettings = vi.fn();
    render(
      <SourcePlaylistList
        playlists={catalogRows}
        sessions={[]}
        onOpen={openFromSettings}
        onImport={importFromSettings}
        syncedAt={settings.onlinePlaylistCatalog?.netease?.syncedAt}
      />,
    );
    fireEvent.change(screen.getAllByRole("searchbox")[0], { target: { value: "电音" } });
    expect(screen.getByText("夜间电音")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Import" })[0]);
    expect(importFromSettings).toHaveBeenCalledWith(catalogRows[1]);
  });
});
