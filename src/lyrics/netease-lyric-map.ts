/**
 * Pure NetEase lyric mappings — request body + response parsing for the eapi
 * `/api/song/lyric/v1` endpoint. Zero IO (mirrors `lrclib-map.ts`): the provider
 * shell wires the cookie-authed eapi request around these. NetEase returns
 * line-level LRC in `lrc.lyric` and (when available) word-level karaoke in
 * `yrc.lyric` — we prefer the latter, tagging it `format: "yrc"` for `parseLyrics`.
 */

import { MATCH_GATE, normalizeTitle, titleSimilarity } from "./match-text";
import type { LyricFormat } from "./model";
import { detectLyricsFormat } from "./parse";
import type { LyricsQuery } from "./provider";

export const NETEASE_LYRIC_URL = "https://interface.music.163.com/eapi/song/lyric/v1";
export const NETEASE_LYRIC_PATH = "/api/song/lyric/v1";

/**
 * The eapi lyric request body. `lv/kv/tv` request the main/karaoke/translation
 * LRC; `yv` requests the word-level **yrc** (per-syllable karaoke); `rv` requests
 * the **romalrc** (romanization) — both when the song has them.
 */
export function buildLyricBody(songId: string): Record<string, unknown> {
  return { id: songId, cp: false, lv: 0, kv: 0, tv: 0, yv: 0, rv: 0 };
}

export interface NeteaseLyricResult {
  /** Raw timed lyric text — line-level LRC, or word-level yrc when `format` says so. */
  synced?: string;
  /** Set to `"yrc"` for word-level lyrics; absent (→ lrc auto-detect) for line-level. */
  format?: LyricFormat;
  /** Raw translation track (line-level LRC), when the song has one. */
  translation?: string;
  /** Raw romanization track (line-level LRC), when the song has one. */
  romanization?: string;
  plain?: string;
  instrumental: boolean;
}

/** A sub-track (translation / roman) is usable only if it survives meta-stripping and has stamps. */
function cleanSubTrack(lyric: unknown): string | undefined {
  const s = stripNeteaseMetaLines(typeof lyric === "string" ? lyric : "");
  return s && HAS_TIMESTAMP.test(s) ? s : undefined;
}

const HAS_TIMESTAMP = /\[\d{1,2}:\d{2}/;
// NetEase ships instrumentals with a single "纯音乐，请欣赏" (pure music) placeholder line.
const PURE_MUSIC = /纯音乐/;

/**
 * Drop NetEase's rich-lyric (yrc) metadata lines, which embed the songwriter /
 * composer / arranger credits as raw JSON in the lyric text, e.g.
 *   {"c":[{"tx":"作词: "},{"tx":"name","li":"…&type=artist"}]}
 * (optionally prefixed by a `[mm:ss.xx]` stamp). Left in, they render as garbled
 * "lyrics". Real lyric lines (plain or `[mm:ss]text`) are kept untouched.
 */
export function stripNeteaseMetaLines(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => {
      const body = line.replace(/^\s*(?:\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\])+\s*/, "").trim();
      return !(body.startsWith("{") && (body.includes('"tx"') || body.includes('"c":[')));
    })
    .join("\n")
    .trim();
}

/** Parse the `/song/lyric/v1` response. Returns null for uncollected/missing lyrics. */
export function parseNeteaseLyric(json: unknown): NeteaseLyricResult | null {
  const j = json as {
    lrc?: { lyric?: unknown };
    yrc?: { lyric?: unknown };
    tlyric?: { lyric?: unknown };
    romalrc?: { lyric?: unknown };
  } | null;

  const translation = cleanSubTrack(j?.tlyric?.lyric);
  const romanization = cleanSubTrack(j?.romalrc?.lyric);

  // Prefer word-level yrc when the song carries it (after dropping credit JSON).
  const yrc = stripNeteaseMetaLines(typeof j?.yrc?.lyric === "string" ? j.yrc.lyric : "");
  if (yrc && detectLyricsFormat(yrc) === "yrc") {
    return { synced: yrc, format: "yrc", translation, romanization, instrumental: false };
  }

  const raw = stripNeteaseMetaLines(typeof j?.lrc?.lyric === "string" ? j.lrc.lyric : "");
  if (!raw) return null;
  if (PURE_MUSIC.test(raw)) return { instrumental: true };
  if (HAS_TIMESTAMP.test(raw))
    return { synced: raw, translation, romanization, instrumental: false };
  return { plain: raw, instrumental: false };
}

/**
 * From a list of search hits, the one whose duration is closest to the target —
 * NetEase cloudsearch ranks by relevance, but duration disambiguates covers /
 * live versions. Falls back to the first hit when no usable target.
 */
export function pickClosestByDuration<T extends { durationSec?: number }>(
  hits: T[],
  durationSec?: number,
): T | null {
  if (hits.length === 0) return null;
  if (durationSec == null || !Number.isFinite(durationSec)) return hits[0];
  let best = hits[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const hit of hits) {
    const delta =
      typeof hit.durationSec === "number"
        ? Math.abs(hit.durationSec - durationSec)
        : Number.POSITIVE_INFINITY;
    if (delta < bestDelta) {
      best = hit;
      bestDelta = delta;
    }
  }
  return best;
}

/** Duration nearness 0..1 against the hard ceiling; 0.5 (neutral) when the target is unknown. */
function songDurationScore(durationSec: number | undefined, target: number | undefined): number {
  if (target == null || !Number.isFinite(target)) return 0.5;
  if (typeof durationSec !== "number") return 0;
  const delta = Math.abs(durationSec - target);
  return delta >= MATCH_GATE.durationHardSec ? 0 : 1 - delta / MATCH_GATE.durationHardSec;
}

/**
 * From cloudsearch song candidates (no lyrics fetched yet), the best by title
 * similarity + duration nearness — so a same-duration cover with the wrong title
 * loses to the real song, and duration only disambiguates among title matches.
 * Title leads (0.6) since NetEase relevance-ranks but can still float covers up.
 */
export function pickBestSong<T extends { title?: string; durationSec?: number }>(
  songs: T[],
  q: LyricsQuery,
): T | null {
  if (songs.length === 0) return null;
  const want = normalizeTitle(q.trackName);
  let best: T | null = null;
  let bestScore = -1;
  for (const song of songs) {
    const titleSim = titleSimilarity(normalizeTitle(song.title ?? ""), want);
    const score = 0.6 * titleSim + 0.4 * songDurationScore(song.durationSec, q.durationSec);
    if (score > bestScore) {
      best = song;
      bestScore = score;
    }
  }
  return best;
}
