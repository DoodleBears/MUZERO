/**
 * Pure text-matching helpers for lyrics lookup — title/artist normalization,
 * candidate scoring, and the accept/reject gate. No IO; exhaustively unit-tested
 * (mirrors `lrclib-map.ts`). These drive the LRCLIB variant ladder, the NetEase
 * search ranking, and the `auto` cross-source pick — kept here so the matching
 * policy lives in one place instead of being scattered across providers.
 *
 * Recall lever (per PRD §4.1): the multilingual version-word list is best-effort,
 * NOT the primary recall path. The main recall fallback is dropping the artist and
 * matching on the normalized title alone (the `titleOnly` ladder rung) — so a
 * missing locale word only costs a little recall, never a wrong match (the gate
 * still guards it).
 */

import type { LyricFormat } from "./model";
import { detectLyricsFormat } from "./parse";
import type { LyricsHit, LyricsQuery } from "./provider";

/** Tunable thresholds for the accept/reject gate. Adjust = edit + revert, never a runtime flag. */
export const MATCH_GATE = {
  /** Soft duration tolerance (s): within this, duration barely dents confidence. */
  durationToleranceSec: 8,
  /** Hard duration ceiling (s): beyond this a candidate is rejected outright (wrong version). */
  durationHardSec: 20,
  /** Minimum composite confidence to accept at the default level. */
  minConfidence: 0.55,
  /** Extra title-similarity floor required by the title-only ladder rung. */
  titleOnlyMinSim: 0.82,
} as const;

/** Confidence weights (sum to 1): tier leads, then duration nearness, then title. */
const WEIGHT = { tier: 0.5, duration: 0.3, title: 0.2 } as const;

/** Word-level synced formats outrank line-level LRC (per PRD §1.1-C / "prefer karaoke"). */
const WORD_FORMATS = new Set<LyricFormat>(["yrc", "qrc", "elrc", "ttml"]);

export type MatchTier = "wordSynced" | "lineSynced" | "plain" | "instrumental";

const TIER_WEIGHT: Record<MatchTier, number> = {
  wordSynced: 1,
  lineSynced: 0.9,
  plain: 0.6,
  instrumental: 0.2,
};

/** Ladder rung a hit came from — feeds the persisted `LyricsMatchInfo.via`. */
export type GateLevel = "exact" | "norm" | "noAlbum" | "titleOnly";

/** The numeric outcome of scoring one candidate against a query. */
export interface CandidateScore {
  /** Composite 0..1 confidence. */
  confidence: number;
  /** |hit duration − query duration| in seconds; undefined when the query has no duration. */
  durationDelta?: number;
  /** Normalized-title similarity 0..1. */
  titleSim: number;
  /** Which content tier the candidate is. */
  tier: MatchTier;
}

// ── Title / artist normalization ─────────────────────────────────────────────

// Version descriptors (lowercased) that mark a parenthetical / dash suffix as a
// release variant rather than part of the real title. Best-effort, multilingual.
const VERSION_WORDS = [
  "live",
  "remaster",
  "remastered",
  "remix",
  "acoustic",
  "unplugged",
  "instrumental",
  "karaoke",
  "demo",
  "radio edit",
  "radio mix",
  "single version",
  "album version",
  "extended",
  "explicit",
  "clean",
  "bonus track",
  "bonus",
  "mono",
  "stereo",
  "deluxe",
  "anniversary",
  "re-recorded",
  "rerecorded",
  "session",
  "version",
  "伴奏",
  "现场",
  "现场版",
  "翻自",
  "重制",
  "纯音乐",
  "live版",
];

const FEAT_RE = /\b(?:feat\.?|ft\.?|featuring)\b/i;
const INLINE_FEAT_RE = /\s+(?:feat\.?|ft\.?|featuring)\b.*$/i;
const TRAILING_GROUP_RE = /\s*[([]([^()[\]]*)[)\]]\s*$/;

function isVersionDescriptor(inner: string): boolean {
  const low = inner.toLowerCase().trim();
  if (!low) return false;
  if (FEAT_RE.test(low)) return true;
  return VERSION_WORDS.some((w) => low.includes(w));
}

/** Full-width parens/brackets → ASCII, so the strip rules see a single shape. */
function foldBrackets(s: string): string {
  return s
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[［【]/g, "[")
    .replace(/[］】]/g, "]");
}

/**
 * Strip release-variant noise so the same song matches across catalogues:
 * trailing version/feat parentheticals & brackets, " - <version>" dash suffixes,
 * and inline "feat. …". Leaves leading or non-version parentheticals intact
 * (e.g. "(Don't Fear) The Reaper", "Song (Part 1)"). Preserves case — comparison
 * casefolds separately, and the cleaned title is also used to build queries.
 */
export function normalizeTitle(raw: string): string {
  let out = foldBrackets(raw ?? "").trim();
  // Peel trailing (..) / [..] groups while they look like a version descriptor.
  for (;;) {
    const m = out.match(TRAILING_GROUP_RE);
    if (!m || !isVersionDescriptor(m[1])) break;
    out = out.slice(0, m.index).trimEnd();
  }
  // Dash suffix: " - 2011 Remaster" / " - Live at …".
  const dash = out.lastIndexOf(" - ");
  if (dash >= 0 && isVersionDescriptor(out.slice(dash + 3))) {
    out = out.slice(0, dash).trimEnd();
  }
  // Inline "feat. …" with no brackets.
  out = out.replace(INLINE_FEAT_RE, "");
  return out.replace(/\s+/g, " ").trim();
}

const ARTIST_SPLIT_RE =
  /\s*(?:,|，|&|;|；|\/|、|×|\bx\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\band\b|与)\s*/i;

/** First-billed artist of a joined string — the collab-stripped recall fallback. */
export function primaryArtist(joined: string): string {
  return (joined ?? "").split(ARTIST_SPLIT_RE)[0]?.trim() ?? "";
}

// ── Title similarity ─────────────────────────────────────────────────────────

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

function tokenJaccard(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 0..1 similarity of two titles: max of token-set Jaccard and normalized edit distance. */
export function titleSimilarity(a: string, b: string): number {
  const na = (a ?? "").toLowerCase().trim();
  const nb = (b ?? "").toLowerCase().trim();
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const jac = tokenJaccard(na, nb);
  const lev = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  return Math.max(jac, lev);
}

// ── Candidate scoring + gate ─────────────────────────────────────────────────

function tierOf(hit: LyricsHit): MatchTier {
  if (hit.instrumental) return "instrumental";
  if (hit.synced) {
    const fmt = hit.format ?? detectLyricsFormat(hit.synced);
    return WORD_FORMATS.has(fmt) ? "wordSynced" : "lineSynced";
  }
  if (hit.plain) return "plain";
  return "instrumental";
}

/** Duration nearness 0..1: 1 at exact, linearly to 0 at the hard ceiling; 0.5 (neutral) when unknown. */
function durationScore(delta: number | undefined): number {
  if (delta === undefined) return 0.5;
  if (delta >= MATCH_GATE.durationHardSec) return 0;
  return 1 - delta / MATCH_GATE.durationHardSec;
}

/** Score one provider candidate against the query. Pure. */
export function scoreCandidate(hit: LyricsHit, q: LyricsQuery): CandidateScore {
  const tier = tierOf(hit);
  const durationDelta =
    q.durationSec != null && Number.isFinite(q.durationSec)
      ? Math.abs(hit.matched.durationSec - q.durationSec)
      : undefined;
  const titleSim = titleSimilarity(
    normalizeTitle(hit.matched.trackName),
    normalizeTitle(q.trackName),
  );
  const confidence =
    WEIGHT.tier * TIER_WEIGHT[tier] +
    WEIGHT.duration * durationScore(durationDelta) +
    WEIGHT.title * titleSim;
  return { confidence, durationDelta, titleSim, tier };
}

/**
 * Whether a scored candidate clears the bar for the given ladder rung. The base
 * bar (confidence + hard-duration guard) applies at every rung; the wide-recall
 * `titleOnly` rung adds a title-similarity floor so a same-name wrong song with a
 * coincidentally close duration is still rejected.
 */
export function passesGate(score: CandidateScore, level: GateLevel): boolean {
  if (score.durationDelta !== undefined && score.durationDelta > MATCH_GATE.durationHardSec) {
    return false;
  }
  if (score.confidence < MATCH_GATE.minConfidence) return false;
  if (level === "titleOnly" && score.titleSim < MATCH_GATE.titleOnlyMinSim) return false;
  return true;
}
