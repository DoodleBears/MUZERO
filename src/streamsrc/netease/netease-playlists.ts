/**
 * NetEase user-library parsing — pure. Syncing playlists from the logged-in account
 * is: account/get → userId, user/playlist → the user's playlists, v6/playlist/detail
 * → the full trackIds, v3/song/detail → each track's display info. These functions own
 * the response shapes; the source wires the (cookie-authed) requests around them.
 */

import type { StreamPlaylist, StreamSearchHit } from "../provider";

interface RawSong {
  id?: number;
  name?: string;
  ar?: Array<{ name?: string }>;
  artists?: Array<{ name?: string }>;
  al?: { name?: string; picUrl?: string };
  album?: { name?: string; picUrl?: string };
  dt?: number;
  duration?: number;
}

/** Map one NetEase song record (cloudsearch / song-detail share this shape) to a hit. */
export function neteaseSongToHit(raw: unknown): StreamSearchHit {
  const song = raw as RawSong;
  const artists = song.ar ?? song.artists ?? [];
  const album = song.al ?? song.album;
  const durationMs = song.dt ?? song.duration;
  return {
    source: "netease",
    externalId: String(song.id ?? ""),
    title: song.name ?? "",
    artist:
      artists
        .map((a) => a.name)
        .filter(Boolean)
        .join("/") || undefined,
    album: album?.name,
    durationSec: typeof durationMs === "number" ? Math.round(durationMs / 1000) : undefined,
    coverUrl: album?.picUrl,
  };
}

/** `/api/nuser/account/get` → the logged-in user id (or null when not logged in). */
export function parseNeteaseUserId(json: unknown): string | null {
  const j = json as { profile?: { userId?: unknown }; account?: { id?: unknown } } | null;
  const id = j?.profile?.userId ?? j?.account?.id;
  return typeof id === "number" && id > 0 ? String(id) : null;
}

interface RawPlaylist {
  id?: unknown;
  name?: unknown;
  coverImgUrl?: unknown;
  trackCount?: unknown;
  trackIds?: unknown[];
}

/** Map one NetEase playlist record (user/playlist item or playlist/detail) to meta. */
function neteasePlaylistToMeta(raw: unknown): StreamPlaylist | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as RawPlaylist;
  const id = String(p.id ?? "");
  if (!id) return null;
  return {
    id,
    name: typeof p.name === "string" ? p.name : "",
    coverUrl: typeof p.coverImgUrl === "string" ? p.coverImgUrl : undefined,
    trackCount:
      typeof p.trackCount === "number"
        ? p.trackCount
        : Array.isArray(p.trackIds)
          ? p.trackIds.length
          : 0,
    source: "netease",
  };
}

/** `/api/user/playlist` → the user's created + subscribed playlists. */
export function parseNeteaseUserPlaylists(json: unknown): StreamPlaylist[] {
  const list = (json as { playlist?: unknown[] } | null)?.playlist ?? [];
  return list.map(neteasePlaylistToMeta).filter((p): p is StreamPlaylist => p !== null);
}

/** `/api/v6/playlist/detail` → the playlist's own meta (name/cover/count) for a pasted link. */
export function parseNeteasePlaylistMeta(json: unknown): StreamPlaylist | null {
  return neteasePlaylistToMeta((json as { playlist?: unknown } | null)?.playlist);
}

/** `/api/v6/playlist/detail` → the FULL ordered trackIds (the `tracks[]` only holds ~10). */
export function parseNeteasePlaylistTrackIds(json: unknown): string[] {
  const trackIds =
    (json as { playlist?: { trackIds?: unknown[] } } | null)?.playlist?.trackIds ?? [];
  return trackIds.map((t) => String((t as { id?: unknown }).id ?? "")).filter(Boolean);
}

/** `/api/v3/song/detail` → hits for a batch of ids. */
export function parseNeteaseSongDetailHits(json: unknown): StreamSearchHit[] {
  const songs = (json as { songs?: unknown[] } | null)?.songs ?? [];
  return songs.map(neteaseSongToHit);
}
