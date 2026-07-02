/**
 * `@`-mention filters for the global (⌘/Ctrl+F) search overlay. Typing `@` opens
 * a small menu to scope the search to a facet — sets, artists, albums — or to a single
 * online source (Bilibili / 网易云 / YouTube / QQ 音乐). This module is the pure parsing core: it
 * detects the trailing `@token` the user is typing and matches it against the
 * available filter options. Labels live at the UI call site (this lib holds no
 * copy, mirroring `library-index` → `entity-labels`).
 */

import type { StreamSourceId, TrackKind } from "@/db/types";
import { normalizeSearchText, searchVariants } from "@/lib/search-transliterate";

/**
 * A chosen scope. The overlay keeps this SINGLE-SELECT (one filter at a time).
 * - facet (`track`/`set`/`lyrics`/`artist`/`album`): narrow to one local section.
 * - `source`: ad-hoc search of one online source.
 * - `online` / `local`: scope axis — online-only vs local-only.
 * - `video` / `audio`: LOCAL media-kind — narrow local songs by `Track.kind`
 *   (never affects online; see the scope-media-filters PRD).
 */
export type SearchFilter =
  | { kind: "track" }
  | { kind: "set" }
  | { kind: "lyrics" }
  | { kind: "artist" }
  | { kind: "album" }
  | { kind: "source"; source: StreamSourceId }
  | { kind: "online" }
  | { kind: "local" }
  | { kind: "video" }
  | { kind: "audio" };

export interface FilterOption {
  /** Stable id (menu key + label switch). */
  id:
    | "track"
    | "set"
    | "lyrics"
    | "artist"
    | "album"
    | "video"
    | "audio"
    | "local"
    | "online"
    | "bili"
    | "netease"
    | "youtube"
    | "qq";
  /** The filter this option produces when chosen. */
  filter: SearchFilter;
  /** Latin + CJK aliases (lowercased) the `@token` prefix-matches against. */
  aliases: string[];
}

/**
 * The offered filters, in menu order. Sources mirror the overlay's enable chips
 * (netease + bili + YouTube + QQ). Aliases carry latin + CJK forms so `@歌手` and
 * `@artist` both narrow to the same option; matching is transliteration-aware
 * (see {@link matchFilterOptions}), so the Chinese aliases are also reachable by
 * pinyin (`@gequ` / `@gd` → 歌曲 / 歌单). Japanese aliases are given in KANA (not
 * kanji): kana → romaji works on the main thread via wanakana, so `@きょく` and
 * `@kyoku` both narrow — whereas a kanji alias would need the worker-only kuromoji
 * reading and so wouldn't romaji-match here.
 */
export const FILTER_OPTIONS: FilterOption[] = [
  {
    id: "track",
    filter: { kind: "track" },
    aliases: [
      "song",
      "songs",
      "track",
      "tracks",
      "title",
      "歌曲",
      "曲目",
      "曲",
      "标题",
      "うた",
      "きょく",
    ],
  },
  {
    id: "set",
    filter: { kind: "set" },
    aliases: [
      "set",
      "sets",
      "playlist",
      "playlists",
      "歌单",
      "列表",
      "プレイリスト",
      "セット",
      "リスト",
    ],
  },
  {
    id: "lyrics",
    filter: { kind: "lyrics" },
    aliases: ["lyrics", "lyric", "lrc", "词", "歌词", "かし"],
  },
  {
    id: "artist",
    filter: { kind: "artist" },
    aliases: ["artist", "artists", "ar", "歌手", "singer", "アーティスト"],
  },
  {
    id: "album",
    filter: { kind: "album" },
    aliases: ["album", "albums", "al", "专辑", "アルバム"],
  },
  // Media-kind (LOCAL only) — narrow local songs by Track.kind. `@Video` / `@Audio`
  // are case-insensitive (matched lowercased), so the capitalized forms work too.
  {
    id: "video",
    filter: { kind: "video" },
    aliases: ["video", "videos", "mv", "视频", "影片", "影像", "どうが", "ビデオ"],
  },
  {
    id: "audio",
    filter: { kind: "audio" },
    aliases: ["audio", "sound", "music", "音频", "音乐", "声音", "おんせい", "おんがく"],
  },
  // Scope axis — local-only vs online-only.
  {
    id: "local",
    filter: { kind: "local" },
    aliases: ["local", "library", "device", "本地", "本机", "离线", "ローカル"],
  },
  {
    id: "online",
    filter: { kind: "online" },
    aliases: ["online", "web", "stream", "在线", "线上", "网络", "オンライン"],
  },
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
 * Whether the typed `@` partial reaches an alias — transliteration-aware, the
 * same treatment song search gives track fields. We prefix-match the normalized
 * needle against every search *variant* of the alias (原文 + 拼音 全拼/首字母 +
 * 假名/罗马音), so a Chinese alias is reachable by pinyin (`gequ`/`gd` → 歌曲/歌单)
 * and a Japanese kana alias by kana ↔ romaji (`きょく`/`kyoku` → 曲).
 *
 * Crucially we transliterate the ALIAS, not the needle: a bare CJK needle like
 * `曲` stays `曲` and only prefix-matches CJK/original variants, so it never leaks
 * into an unrelated latin alias through a one-letter pinyin initial (e.g. 曲→`q`
 * would otherwise hit `qq`). The variant set always includes the normalized
 * original, so this is a strict superset of the old raw prefix match; before the
 * dictionaries load `searchVariants` yields normalize-only variants, degrading to
 * exactly that raw prefix so behavior never regresses.
 */
function aliasMatchesPartial(alias: string, needle: string): boolean {
  return searchVariants(alias).some((variant) => variant.startsWith(needle));
}

/**
 * Filter options whose alias matches the typed partial (empty → all), matched
 * transliteration-aware via {@link aliasMatchesPartial}. Pass a pre-filtered
 * `options` list to hide source filters where streaming is unavailable (web /
 * Tauri).
 */
export function matchFilterOptions(
  partial: string,
  options: readonly FilterOption[] = FILTER_OPTIONS,
): FilterOption[] {
  const needle = normalizeSearchText(partial);
  if (!needle) return [...options];
  return options.filter((opt) => opt.aliases.some((alias) => aliasMatchesPartial(alias, needle)));
}

/**
 * Which sections + worker/online the active (single-select) filter permits — the
 * one arbiter the overlay reads (mirrors `resolveStageContent` / `resolveFlowColors`).
 * Pure + exhaustively unit-tested so the gating never drifts across the heavy component.
 *
 * - `runsLocalWorker`: false for `online` / `source` (online-only) and `lyrics`
 *   (its own full-text path) — so the overlay can skip `db.tracks.toArray()`.
 * - `showOnline`: requires streaming support; false for every local-scoped filter
 *   (`local` / `video` / `audio`) so the online network hook gets an empty query.
 * - `mediaKind`: only `video` / `audio` — pushed into the local worker as a `Track.kind`
 *   predicate. LOCAL only; online results are never kind-filtered.
 */
export interface FilterScope {
  showSets: boolean;
  showTracks: boolean;
  showLyrics: boolean;
  showAlbums: boolean;
  showArtists: boolean;
  showOnline: boolean;
  /** Local-worker media-kind predicate (`@video` / `@audio` only). */
  mediaKind?: TrackKind;
  /** Whether the local library worker should run for this filter at all. */
  runsLocalWorker: boolean;
}

export function resolveFilterScope(
  filter: SearchFilter | null,
  streamingSupported: boolean,
): FilterScope {
  const kind = filter?.kind ?? null;
  // Local sections that participate in the kind concept narrow to songs only for
  // `@video` / `@audio`; `@local` shows every local section; facets show their own.
  const isMediaKind = kind === "video" || kind === "audio";
  const isLocalScope = kind === "local";
  const localAll = kind === null || isLocalScope;
  return {
    showSets: localAll || kind === "set",
    showTracks: localAll || kind === "track" || isMediaKind,
    showLyrics: kind === "lyrics",
    showAlbums: localAll || kind === "album",
    showArtists: localAll || kind === "artist",
    showOnline: streamingSupported && (kind === null || kind === "online" || kind === "source"),
    mediaKind: kind === "video" ? "video" : kind === "audio" ? "audio" : undefined,
    runsLocalWorker: kind !== "online" && kind !== "source" && kind !== "lyrics",
  };
}
