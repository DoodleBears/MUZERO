/**
 * `@`-mention filters for the global (⌘/Ctrl+F) search overlay. Typing `@` opens
 * a small menu to scope the search to a facet — sets, artists, albums — or to a single
 * online source (Bilibili / 网易云 / YouTube / QQ 音乐). This module is the pure parsing core: it
 * detects the trailing `@token` the user is typing and matches it against the
 * available filter options. Labels live at the UI call site (this lib holds no
 * copy, mirroring `library-index` → `entity-labels`).
 */

import type { StreamSourceId } from "@/db/types";

/** A chosen scope. `source` forces an ad-hoc search of one online source. */
export type SearchFilter =
  | { kind: "track" }
  | { kind: "set" }
  | { kind: "lyrics" }
  | { kind: "artist" }
  | { kind: "album" }
  | { kind: "source"; source: StreamSourceId };

export interface FilterOption {
  /** Stable id (menu key + label switch). */
  id: "track" | "set" | "lyrics" | "artist" | "album" | "bili" | "netease" | "youtube" | "qq";
  /** The filter this option produces when chosen. */
  filter: SearchFilter;
  /** Latin + CJK aliases (lowercased) the `@token` prefix-matches against. */
  aliases: string[];
}

/**
 * The offered filters, in menu order. Sources mirror the overlay's enable chips
 * (netease + bili + YouTube + QQ). Aliases carry both latin and CJK forms so `@歌手`
 * and `@artist` both narrow to the same option.
 */
export const FILTER_OPTIONS: FilterOption[] = [
  {
    id: "track",
    filter: { kind: "track" },
    aliases: ["song", "songs", "track", "tracks", "title", "歌曲", "曲目", "曲", "标题"],
  },
  {
    id: "set",
    filter: { kind: "set" },
    aliases: ["set", "sets", "playlist", "playlists", "歌单", "列表"],
  },
  {
    id: "lyrics",
    filter: { kind: "lyrics" },
    aliases: ["lyrics", "lyric", "lrc", "词", "歌词"],
  },
  {
    id: "artist",
    filter: { kind: "artist" },
    aliases: ["artist", "artists", "ar", "歌手", "singer"],
  },
  { id: "album", filter: { kind: "album" }, aliases: ["album", "albums", "al", "专辑"] },
  {
    id: "bili",
    filter: { kind: "source", source: "bili" },
    aliases: ["bilibili", "bili", "b站", "哔哩"],
  },
  {
    id: "netease",
    filter: { kind: "source", source: "netease" },
    aliases: ["netease", "网易云", "网易", "wyy"],
  },
  {
    id: "youtube",
    filter: { kind: "source", source: "youtube" },
    aliases: ["youtube", "yt", "ytb", "油管"],
  },
  {
    id: "qq",
    filter: { kind: "source", source: "qq" },
    aliases: ["qq", "qqmusic", "qq音乐", "腾讯"],
  },
];

export interface MentionState {
  /** True while the trailing token is an unclosed `@mention` (no whitespace after). */
  active: boolean;
  /** Text after the `@` (the menu filter); empty for a bare `@`. */
  partial: string;
  /** The query with the trailing `@token` removed — what we actually search. */
  before: string;
}

// The trailing whitespace-delimited token that starts with `@`. Requires a start
// or whitespace boundary before `@` so it never triggers mid-word (e.g. emails),
// and `$` so it closes once the user types a space after the mention.
const TRAILING_MENTION = /(^|\s)@(\S*)$/;

/** Detect the `@mention` the caret is currently inside (at the end of `value`). */
export function parseMention(value: string): MentionState {
  const match = value.match(TRAILING_MENTION);
  if (!match || match.index === undefined) {
    return { active: false, partial: "", before: value };
  }
  // Keep the leading boundary char (the space) so free text before the mention
  // — e.g. "love @art" — is preserved as the search text.
  const before = value.slice(0, match.index + match[1].length);
  return { active: true, partial: match[2], before };
}

/**
 * Filter options whose alias prefix-matches the typed partial (empty → all).
 * Pass a pre-filtered `options` list to hide source filters where streaming is
 * unavailable (web / Tauri).
 */
export function matchFilterOptions(
  partial: string,
  options: readonly FilterOption[] = FILTER_OPTIONS,
): FilterOption[] {
  const needle = partial.trim().toLowerCase();
  if (!needle) return [...options];
  return options.filter((opt) =>
    opt.aliases.some((alias) => alias.toLowerCase().startsWith(needle)),
  );
}
