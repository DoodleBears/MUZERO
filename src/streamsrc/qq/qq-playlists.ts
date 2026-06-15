/**
 * QQ Music search / song-detail parsing — pure. `client_search_cp` returns songs
 * under `data.song.list[]`; `musicu get_song_detail_yqq` returns one under
 * `songinfo.data.track_info`. Both share a tolerant song shape (field names drift
 * between endpoints), mapped to a StreamSearchHit. The cover comes from the album
 * mid via the y.qq.com photo template. `interval` is in SECONDS (unlike NetEase ms).
 */

import type { StreamSearchHit } from "../provider";

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
