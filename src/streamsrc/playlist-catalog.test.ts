import { describe, expect, it, vi } from "vitest";
import type { AppSettings, OnlinePlaylistCatalogSource, StreamSourceId } from "@/db/types";
import {
  clearOnlinePlaylistCatalogSource,
  filterOnlinePlaylists,
  isOnlinePlaylistCatalogStale,
  mergeOnlinePlaylistCatalogSource,
  onlinePlaylistCatalogSourcesToSync,
  syncOnlinePlaylistCatalogSource,
} from "./playlist-catalog";
import type { StreamPlaylist, StreamSourceProvider } from "./provider";

function playlist(
  source: StreamSourceId,
  id: string,
  name: string,
  trackCount = 1,
): StreamPlaylist {
  return { source, id, name, trackCount };
}

function sourceProvider(
  id: StreamSourceId,
  playlists: StreamPlaylist[],
): Pick<StreamSourceProvider, "getUserPlaylists" | "id" | "isAuthed" | "label" | "requiresLogin"> {
  return {
    id,
    label: id,
    requiresLogin: true,
    isAuthed: () => true,
    getUserPlaylists: vi.fn(async () => playlists),
  };
}

describe("online playlist catalog", () => {
  it("merges a source catalog, deduping by source/id and stamping syncedAt", () => {
    const now = 1000;
    const next = mergeOnlinePlaylistCatalogSource(
      {},
      "netease",
      [
        playlist("netease", "1", "Daily", 10),
        playlist("netease", "1", "Daily duplicate", 11),
        playlist("netease", "2", "Night", 12),
      ],
      now,
    );

    expect(next.netease).toEqual({
      attemptedAt: now,
      syncedAt: now,
      playlists: [playlist("netease", "1", "Daily", 10), playlist("netease", "2", "Night", 12)],
    });
  });

  it("updates one source without dropping other sources", () => {
    const current = {
      bili: {
        syncedAt: 1,
        playlists: [playlist("bili", "b1", "Bili Fav")],
      },
    } satisfies Partial<Record<StreamSourceId, OnlinePlaylistCatalogSource>>;

    const next = mergeOnlinePlaylistCatalogSource(
      current,
      "netease",
      [playlist("netease", "n1", "NetEase")],
      2,
    );

    expect(next.bili).toEqual(current.bili);
    expect(next.netease?.playlists).toEqual([playlist("netease", "n1", "NetEase")]);
  });

  it("clears one source catalog on logout", () => {
    const current = {
      netease: { syncedAt: 1, playlists: [playlist("netease", "n1", "NetEase")] },
      bili: { syncedAt: 2, playlists: [playlist("bili", "b1", "Bili")] },
    } satisfies Partial<Record<StreamSourceId, OnlinePlaylistCatalogSource>>;

    expect(clearOnlinePlaylistCatalogSource(current, "netease")).toEqual({
      bili: current.bili,
    });
  });

  it("treats missing or expired catalogs as stale", () => {
    expect(isOnlinePlaylistCatalogStale(undefined, 1000)).toBe(true);
    expect(isOnlinePlaylistCatalogStale({ syncedAt: 0 }, 1000, 15 * 60_000)).toBe(false);
    expect(isOnlinePlaylistCatalogStale({ syncedAt: 0 }, 901_000, 15 * 60_000)).toBe(true);
    expect(
      isOnlinePlaylistCatalogStale({ syncedAt: 0, attemptedAt: 900_000 }, 901_000, 15 * 60_000),
    ).toBe(false);
  });

  it("selects enabled sources whose catalog is missing or stale", () => {
    const settings = {
      streamSources: {
        netease: { enabled: true, cookie: "MUSIC_U=x" },
        bili: { enabled: true, cookie: "SESSDATA=x" },
        qq: { enabled: false, cookie: "qqmusic_key=x" },
      },
      onlinePlaylistCatalog: {
        netease: { syncedAt: 0, playlists: [] },
        bili: { syncedAt: 1000, playlists: [] },
      },
    } satisfies Pick<AppSettings, "onlinePlaylistCatalog" | "streamSources">;

    expect(onlinePlaylistCatalogSourcesToSync(settings, 901_000)).toEqual(["netease"]);
    expect(onlinePlaylistCatalogSourcesToSync(settings, 902_000, { force: true })).toEqual([
      "netease",
      "bili",
    ]);
  });

  it("filters by playlist text, source id, and localized source aliases", () => {
    const rows = [
      playlist("netease", "n1", "只熊喜欢的音乐"),
      playlist("bili", "b1", "动画收藏"),
      playlist("qq", "q1", "夜跑"),
    ];

    expect(filterOnlinePlaylists(rows, "喜欢").map((p) => p.id)).toEqual(["n1"]);
    expect(filterOnlinePlaylists(rows, "bilibili").map((p) => p.id)).toEqual(["b1"]);
    expect(filterOnlinePlaylists(rows, "网易").map((p) => p.id)).toEqual(["n1"]);
    expect(filterOnlinePlaylists(rows, "qq").map((p) => p.id)).toEqual(["q1"]);
  });

  it("syncs one source and persists a catalog patch", async () => {
    const settings = {
      id: "app",
      onlinePlaylistCatalog: {
        bili: { syncedAt: 1, playlists: [playlist("bili", "b1", "Bili")] },
      },
    } as AppSettings;
    const save = vi.fn(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));
    const provider = sourceProvider("netease", [
      playlist("netease", "1", "Daily"),
      playlist("netease", "1", "Daily dupe"),
    ]);

    const result = await syncOnlinePlaylistCatalogSource("netease", {
      settings,
      now: () => 123,
      save,
      createSource: () => provider as StreamSourceProvider,
    });

    expect(result.kind).toBe("ok");
    expect(provider.getUserPlaylists).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({
      onlinePlaylistCatalog: {
        bili: settings.onlinePlaylistCatalog?.bili,
        netease: {
          attemptedAt: 123,
          syncedAt: 123,
          playlists: [playlist("netease", "1", "Daily")],
        },
      },
    });
  });

  it("keeps stale data and stores an error when source sync fails", async () => {
    const settings = {
      id: "app",
      onlinePlaylistCatalog: {
        netease: { syncedAt: 1, playlists: [playlist("netease", "old", "Old")] },
      },
    } as AppSettings;
    const save = vi.fn(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));

    const result = await syncOnlinePlaylistCatalogSource("netease", {
      settings,
      now: () => 200,
      save,
      createSource: () =>
        ({
          id: "netease",
          label: "netease",
          requiresLogin: true,
          isAuthed: () => true,
          getUserPlaylists: vi.fn(async () => {
            throw new Error("network down");
          }),
        }) as unknown as StreamSourceProvider,
    });

    expect(result).toEqual({ kind: "error", message: "network down" });
    expect(save).toHaveBeenCalledWith({
      onlinePlaylistCatalog: {
        netease: {
          attemptedAt: 200,
          syncedAt: 1,
          playlists: [playlist("netease", "old", "Old")],
          error: "network down",
        },
      },
    });
    const patch = save.mock.calls[0]?.[0];
    expect(
      onlinePlaylistCatalogSourcesToSync(
        {
          streamSources: { netease: { enabled: true, cookie: "MUSIC_U=x" } },
          onlinePlaylistCatalog: patch?.onlinePlaylistCatalog,
        },
        201,
      ),
    ).toEqual([]);
  });

  it("throttles repeated auto-sync after a first-time source error", async () => {
    const settings = {
      id: "app",
      streamSources: { netease: { enabled: true, cookie: "MUSIC_U=x" } },
    } as AppSettings;
    const save = vi.fn(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch }));

    await syncOnlinePlaylistCatalogSource("netease", {
      settings,
      now: () => 300,
      save,
      createSource: () =>
        ({
          id: "netease",
          label: "netease",
          requiresLogin: true,
          isAuthed: () => true,
          getUserPlaylists: vi.fn(async () => {
            throw new Error("temporary netease failure");
          }),
        }) as unknown as StreamSourceProvider,
    });

    const patch = save.mock.calls[0]?.[0];
    expect(patch?.onlinePlaylistCatalog?.netease).toEqual({
      attemptedAt: 300,
      syncedAt: 0,
      playlists: [],
      error: "temporary netease failure",
    });
    expect(
      onlinePlaylistCatalogSourcesToSync(
        {
          streamSources: settings.streamSources,
          onlinePlaylistCatalog: patch?.onlinePlaylistCatalog,
        },
        301,
      ),
    ).toEqual([]);
  });
});
