import type {
  AppSettings,
  OnlinePlaylistCatalogEntry,
  OnlinePlaylistCatalogSource,
  StreamSourceId,
} from "@/db/types";
import type { StreamPlaylist, StreamSourceProvider } from "./provider";
import { STREAM_SOURCE_IDS } from "./registry";

export const ONLINE_PLAYLIST_CATALOG_STALE_MS = 15 * 60_000;

const SOURCE_ALIASES: Record<StreamSourceId, string[]> = {
  netease: ["netease", "网易", "网易云", "wangyi", "163"],
  bili: ["bili", "bilibili", "哔哩", "哔哩哔哩", "b站", "b站"],
  youtube: ["youtube", "yt", "油管"],
  qq: ["qq", "qq音乐", "tencent", "腾讯"],
};

export const STREAM_SOURCE_DISPLAY_NAMES: Record<StreamSourceId, string> = {
  netease: "网易云",
  bili: "Bilibili",
  youtube: "YouTube",
  qq: "QQ 音乐",
};

export type OnlinePlaylistCatalog = Partial<Record<StreamSourceId, OnlinePlaylistCatalogSource>>;

export type SyncOnlinePlaylistCatalogResult =
  | { kind: "ok"; source: StreamSourceId; playlists: OnlinePlaylistCatalogEntry[] }
  | { kind: "skipped"; source: StreamSourceId; reason: "missing-provider" | "unsupported" }
  | { kind: "error"; message: string };

export interface SyncOnlinePlaylistCatalogSourceOptions {
  settings: AppSettings;
  now?: () => number;
  save: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  createSource: (source: StreamSourceId) => StreamSourceProvider | null;
  signal?: AbortSignal;
}

export function playlistCatalogEntry(playlist: StreamPlaylist): OnlinePlaylistCatalogEntry {
  return {
    id: playlist.id,
    name: playlist.name,
    ...(playlist.coverUrl ? { coverUrl: playlist.coverUrl } : {}),
    trackCount: playlist.trackCount,
    source: playlist.source,
  };
}

export function mergeOnlinePlaylistCatalogSource(
  current: OnlinePlaylistCatalog | undefined,
  source: StreamSourceId,
  playlists: readonly StreamPlaylist[],
  syncedAt: number,
): OnlinePlaylistCatalog {
  const seen = new Set<string>();
  const deduped: OnlinePlaylistCatalogEntry[] = [];
  for (const playlist of playlists) {
    const key = `${playlist.source}:${playlist.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(playlistCatalogEntry(playlist));
  }
  return {
    ...(current ?? {}),
    [source]: {
      syncedAt,
      playlists: deduped,
    },
  };
}

export function markOnlinePlaylistCatalogSourceError(
  current: OnlinePlaylistCatalog | undefined,
  source: StreamSourceId,
  message: string,
): OnlinePlaylistCatalog {
  const existing = current?.[source];
  return {
    ...(current ?? {}),
    [source]: {
      syncedAt: existing?.syncedAt ?? 0,
      playlists: existing?.playlists ?? [],
      error: message,
    },
  };
}

export function clearOnlinePlaylistCatalogSource(
  current: OnlinePlaylistCatalog | undefined,
  source: StreamSourceId,
): OnlinePlaylistCatalog {
  const next = { ...(current ?? {}) };
  delete next[source];
  return next;
}

export function isOnlinePlaylistCatalogStale(
  source: Pick<OnlinePlaylistCatalogSource, "syncedAt"> | undefined,
  now: number,
  staleMs = ONLINE_PLAYLIST_CATALOG_STALE_MS,
): boolean {
  if (!source) return true;
  return now - source.syncedAt > staleMs;
}

export function onlinePlaylistCatalogSourcesToSync(
  settings: Pick<AppSettings, "onlinePlaylistCatalog" | "streamSources">,
  now: number,
  opts: { force?: boolean; staleMs?: number } = {},
): StreamSourceId[] {
  return STREAM_SOURCE_IDS.filter((source) => {
    if (!settings.streamSources?.[source]?.enabled) return false;
    return (
      opts.force ||
      isOnlinePlaylistCatalogStale(
        settings.onlinePlaylistCatalog?.[source],
        now,
        opts.staleMs ?? ONLINE_PLAYLIST_CATALOG_STALE_MS,
      )
    );
  });
}

export function allOnlinePlaylistCatalogEntries(
  catalog: OnlinePlaylistCatalog | undefined,
): OnlinePlaylistCatalogEntry[] {
  if (!catalog) return [];
  return Object.values(catalog).flatMap((source) => source?.playlists ?? []);
}

export function filterOnlinePlaylists<
  T extends Pick<OnlinePlaylistCatalogEntry, "name" | "source">,
>(playlists: readonly T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...playlists];
  return playlists.filter((playlist) => {
    const haystack = [playlist.name, playlist.source, ...SOURCE_ALIASES[playlist.source]]
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(q);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function syncOnlinePlaylistCatalogSource(
  source: StreamSourceId,
  opts: SyncOnlinePlaylistCatalogSourceOptions,
): Promise<SyncOnlinePlaylistCatalogResult> {
  const provider = opts.createSource(source);
  if (!provider) return { kind: "skipped", source, reason: "missing-provider" };
  if (!provider.getUserPlaylists) return { kind: "skipped", source, reason: "unsupported" };

  try {
    const playlists = await provider.getUserPlaylists({ signal: opts.signal });
    const onlinePlaylistCatalog = mergeOnlinePlaylistCatalogSource(
      opts.settings.onlinePlaylistCatalog,
      source,
      playlists,
      opts.now?.() ?? Date.now(),
    );
    await opts.save({ onlinePlaylistCatalog });
    return {
      kind: "ok",
      source,
      playlists: onlinePlaylistCatalog[source]?.playlists ?? [],
    };
  } catch (error) {
    const message = errorMessage(error);
    const onlinePlaylistCatalog = markOnlinePlaylistCatalogSourceError(
      opts.settings.onlinePlaylistCatalog,
      source,
      message,
    );
    await opts.save({ onlinePlaylistCatalog });
    return { kind: "error", message };
  }
}
