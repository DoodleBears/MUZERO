/**
 * Bilibili fav-folder (收藏夹) parsing — pure. Syncing favlists is: nav → mid,
 * `/x/v3/fav/folder/created/list-all` → the user's folders, `/x/v3/fav/resource/list`
 * → one folder's contents (paginated, carries the folder `info` too). These functions own
 * the response shapes; the source wires the (WBI-signed, cookie-authed) requests around
 * them. Mirrors netease-playlists / qq-playlists.
 *
 * Reference: yt-dlp's bilibili extractor (favlist URLs) — the bilibili-API-collect doc is
 * defunct (see the video-download PRD §8).
 */

import type { StreamPlaylist, StreamSearchHit } from "../provider";

/** Bilibili cover URLs come back protocol-relative (`//i0.hdslb.com/…`). */
function normalizeCover(cover: unknown): string | undefined {
  if (typeof cover !== "string" || !cover) return undefined;
  return cover.startsWith("//") ? `https:${cover}` : cover;
}

interface RawFolder {
  id?: number;
  title?: string;
  media_count?: number;
  cover?: string;
}

/** Map `/x/v3/fav/folder/created/list-all` `data.list[]` to playlists. */
export function parseFavFolders(json: unknown): StreamPlaylist[] {
  const list = (json as { data?: { list?: RawFolder[] } } | null)?.data?.list;
  if (!Array.isArray(list)) return [];
  const out: StreamPlaylist[] = [];
  for (const folder of list) {
    if (typeof folder.id !== "number") continue;
    out.push({
      source: "bili",
      id: String(folder.id),
      name: folder.title ?? String(folder.id),
      trackCount: typeof folder.media_count === "number" ? folder.media_count : 0,
      coverUrl: normalizeCover(folder.cover),
    });
  }
  return out;
}

interface RawFavInfo {
  id?: number;
  title?: string;
  media_count?: number;
  cover?: string;
}

/** Read the folder meta from a `/x/v3/fav/resource/list` response (`data.info`). */
export function parseFavInfo(json: unknown): StreamPlaylist | null {
  const info = (json as { data?: { info?: RawFavInfo } } | null)?.data?.info;
  if (!info || typeof info.id !== "number") return null;
  return {
    source: "bili",
    id: String(info.id),
    name: info.title ?? String(info.id),
    trackCount: typeof info.media_count === "number" ? info.media_count : 0,
    coverUrl: normalizeCover(info.cover),
  };
}

interface RawMedia {
  bvid?: string;
  title?: string;
  cover?: string;
  duration?: number;
  upper?: { name?: string };
}

/** Map one page of `/x/v3/fav/resource/list` (`data.medias[]` + `data.has_more`) to hits. */
export function parseFavResourceList(json: unknown): {
  hits: StreamSearchHit[];
  hasMore: boolean;
} {
  const data = (json as { data?: { medias?: RawMedia[] | null; has_more?: boolean } } | null)?.data;
  const medias = data?.medias;
  if (!Array.isArray(medias)) return { hits: [], hasMore: false };
  const hits: StreamSearchHit[] = [];
  for (const media of medias) {
    if (!media.bvid) continue; // removed / invalid favlist entries have no bvid
    hits.push({
      source: "bili",
      externalId: media.bvid,
      title: media.title ?? media.bvid,
      artist: media.upper?.name,
      durationSec: typeof media.duration === "number" ? media.duration : undefined,
      coverUrl: normalizeCover(media.cover),
    });
  }
  return { hits, hasMore: data?.has_more === true };
}
