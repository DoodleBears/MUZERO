import { NO_MATCH_SCORE, scoreVariants, searchVariants } from "@/lib/search-transliterate";

/**
 * Source-agnostic search core. Both local tracks and synced remote-catalog rows
 * map to an `IndexableRow` (id + scoped field strings), so one matcher serves
 * the whole library — and the off-thread search Worker can query local + remote
 * uniformly. Matching is transliteration-aware (pinyin / kana / romaji) via
 * [`search-transliterate`]; field-variant computation is memoized there, so the
 * per-keystroke cost is just query-side variants + scoring.
 */

/** Field-scoped query tokens, all lowercased. */
export interface SearchTokens {
  /** Bare tokens, matched against any field. */
  free: string[];
  /** `artist:` tokens, matched against the artist / album-artist fields. */
  artist: string[];
  /** `album:` tokens, matched against the album field. */
  album: string[];
  /** `#tag` tokens, matched against tags only. */
  tags: string[];
}

/** Split a query into field-scoped tokens (`artist:`/`album:`/`#tag`) + free text. */
export function parseSearchTokens(query: string): SearchTokens {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const result: SearchTokens = { free: [], artist: [], album: [], tags: [] };
  for (const token of tokens) {
    if (token.startsWith("#") && token.length > 1) result.tags.push(token.slice(1));
    else if (token.startsWith("artist:") && token.length > 7) result.artist.push(token.slice(7));
    else if (token.startsWith("album:") && token.length > 6) result.album.push(token.slice(6));
    else result.free.push(token);
  }
  return result;
}

export function isEmptyTokens(tokens: SearchTokens): boolean {
  return (
    tokens.free.length === 0 &&
    tokens.artist.length === 0 &&
    tokens.album.length === 0 &&
    tokens.tags.length === 0
  );
}

/** A searchable row reduced to its scoped field strings (original casing). */
export interface IndexableRow {
  id: string;
  /** Free-scope fields (title, caption, note, genres, tags, memories, …). */
  free: string[];
  /** Artist-scope fields (artists / album-artists). */
  artist: string[];
  /** Album-scope field(s). */
  album: string[];
  /** Tags (already normalized). */
  tags: string[];
}

export interface QueryHit {
  id: string;
  score: number;
}

/** Best (lowest) score for one query token across a set of candidate fields. */
function bestTokenScore(token: string, fields: readonly string[]): number {
  const queryVariants = searchVariants(token);
  let best = NO_MATCH_SCORE;
  for (const field of fields) {
    if (!field) continue;
    const score = scoreVariants(queryVariants, searchVariants(field));
    if (score < best) best = score;
    if (best === 0) break; // can't beat exact
  }
  return best;
}

/** Sum of per-token best scores, or `NO_MATCH_SCORE` if any token is unmatched. */
function scopeScore(tokens: readonly string[], fields: readonly string[]): number {
  let total = 0;
  for (const token of tokens) {
    const best = bestTokenScore(token, fields);
    if (best >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
    total += best;
  }
  return total;
}

/**
 * Relevance score for a row against parsed tokens (lower = better). 0 for an
 * empty query; `NO_MATCH_SCORE` when any token's scope has no match; otherwise
 * the summed best score capped just below the sentinel (so matches always sort
 * ahead of non-matches).
 */
export function scoreRow(row: IndexableRow, tokens: SearchTokens): number {
  if (isEmptyTokens(tokens)) return 0;
  const free = scopeScore(tokens.free, row.free);
  if (free >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
  const artist = scopeScore(tokens.artist, row.artist);
  if (artist >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
  const album = scopeScore(tokens.album, row.album);
  if (album >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
  const tags = scopeScore(tokens.tags, row.tags);
  if (tags >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
  return Math.min(free + artist + album + tags, NO_MATCH_SCORE - 1);
}

/**
 * Filter + rank rows by query relevance (best match first; stable for ties via
 * input order). An empty query returns every row in order with score 0. Returns
 * `{ id, score }` so callers can map ids back onto their own row objects.
 */
export function queryRows(rows: readonly IndexableRow[], query: string): QueryHit[] {
  if (!query.trim()) return rows.map((row) => ({ id: row.id, score: 0 }));
  const tokens = parseSearchTokens(query);
  return rows
    .map((row, index) => ({ id: row.id, index, score: scoreRow(row, tokens) }))
    .filter((entry) => entry.score < NO_MATCH_SCORE)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => ({ id: entry.id, score: entry.score }));
}
