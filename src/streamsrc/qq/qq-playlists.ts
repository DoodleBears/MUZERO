/**
 * QQ Music search / song-detail parsing — pure. `client_search_cp` returns songs
 * under `data.song.list[]`; `musicu get_song_detail_yqq` returns one under
 * `songinfo.data.track_info`. Both share a tolerant song shape (field names drift
 * between endpoints), mapped to a StreamSearchHit. The cover comes from the album
 * mid via the y.qq.com photo template. `interval` is in SECONDS (unlike NetEase ms).
 */

import type { StreamPlaylist, StreamSearchHit } from "../provider";

/** y.qq.com album-cover URL from an album mid. */
export function qqAlbumCover(albumMid: string): string {
  return `https://y.qq.com/music/photo_new/T002R800x800M000${albumMid}.jpg`;
}

interface RawQqSinger {
  name?: unknown;
  title?: unknown;
}
interface RawQqSong {
  songmid?: unknown;
  mid?: unknown;
  songname?: unknown;
  name?: unknown;
  title?: unknown;
  singer?: RawQqSinger[];
  album?: { name?: unknown; mid?: unknown };
  albumname?: unknown;
  albummid?: unknown;
  interval?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Map one QQ song record (search list item or track_info) to a hit. */
export function qqSongToHit(raw: unknown): StreamSearchHit {
  const s = (raw ?? {}) as RawQqSong;
  const mid = str(s.songmid) ?? str(s.mid) ?? "";
  const albumMid = str(s.album?.mid) ?? str(s.albummid);
  const singers = Array.isArray(s.singer) ? s.singer : [];
  return {
    source: "qq",
    externalId: mid,
    title: str(s.songname) ?? str(s.name) ?? str(s.title) ?? "",
    artist:
      singers
        .map((x) => str(x.name) ?? str(x.title))
        .filter((n): n is string => Boolean(n))
        .join("/") || undefined,
    album: str(s.album?.name) ?? str(s.albumname),
    durationSec: typeof s.interval === "number" ? s.interval : undefined,
    coverUrl: albumMid ? qqAlbumCover(albumMid) : undefined,
  };
}

/** `client_search_cp` → hits (`data.song.list[]`, tolerant of `data.list[]`). */
export function parseQqSearch(json: unknown): StreamSearchHit[] {
  const j = json as { data?: { song?: { list?: unknown[] }; list?: unknown[] } } | null;
  const list = j?.data?.song?.list ?? j?.data?.list ?? [];
  return (Array.isArray(list) ? list : []).map(qqSongToHit).filter((h) => h.externalId);
}

/** `musicu get_song_detail_yqq` → a single hit (or null). */
export function parseQqSongDetail(json: unknown): StreamSearchHit | null {
  const j = json as {
    songinfo?: { data?: { track_info?: unknown } };
    data?: { track_info?: unknown };
  } | null;
  const ti = j?.songinfo?.data?.track_info ?? j?.data?.track_info;
  if (!ti) return null;
  const hit = qqSongToHit(ti);
  return hit.externalId ? hit : null;
}

interface RawQqDirInfo {
  id?: unknown;
  disstid?: unknown;
  dissid?: unknown;
  title?: unknown;
  dissname?: unknown;
  picurl?: unknown;
  logo?: unknown;
  songnum?: unknown;
  total_song_num?: unknown;
  songlist?: unknown[];
}
interface RawQqDiss {
  dirinfo?: RawQqDirInfo;
  cdlist?: RawQqDirInfo[];
  songlist?: unknown[];
}

/** Unwrap musicu `req_0.data` (or a bare `data`) to the diss payload. */
function qqDissData(json: unknown): RawQqDiss | null {
  const r = json as { req_0?: { data?: unknown }; data?: unknown } | null;
  const data = r?.req_0?.data ?? r?.data ?? json;
  return data && typeof data === "object" ? (data as RawQqDiss) : null;
}

/** First positive number / non-empty string, as a string (id may arrive either way). */
function idStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "number" && v > 0) return String(v);
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

/** `music.srfDissInfo.aiDissInfo` → playlist meta (tolerant of `dirinfo` / `cdlist[0]`). */
export function parseQqPlaylistMeta(json: unknown): StreamPlaylist | null {
  const data = qqDissData(json);
  if (!data) return null;
  const dir = data.dirinfo ?? (Array.isArray(data.cdlist) ? data.cdlist[0] : undefined);
  if (!dir) return null;
  const id = idStr(dir.id, dir.disstid, dir.dissid);
  if (!id) return null;
  const songlist = data.songlist ?? dir.songlist ?? [];
  return {
    id,
    name: str(dir.title) ?? str(dir.dissname) ?? "",
    coverUrl: str(dir.picurl) ?? str(dir.logo),
    trackCount:
      typeof dir.songnum === "number"
        ? dir.songnum
        : typeof dir.total_song_num === "number"
          ? dir.total_song_num
          : Array.isArray(songlist)
            ? songlist.length
            : 0,
    source: "qq",
  };
}

/** `music.srfDissInfo.aiDissInfo` → the playlist's songs as hits. */
export function parseQqPlaylistTracks(json: unknown): StreamSearchHit[] {
  const data = qqDissData(json);
  const dir = data?.dirinfo ?? (Array.isArray(data?.cdlist) ? data?.cdlist[0] : undefined);
  const songlist = data?.songlist ?? dir?.songlist ?? [];
  return (Array.isArray(songlist) ? songlist : []).map(qqSongToHit).filter((h) => h.externalId);
}
