/**
 * Precomputed-variant search index (PRD
 * `20260615-muzero-global-search-index-performance` Phase 3 — ★core).
 *
 * The original worker re-ran the transliteration dictionaries (pinyin / kana)
 * for EVERY field of EVERY row on EVERY keystroke, and a 4000-entry variant
 * cache thrashed against a 60k–100k-field library → ~3s typing latency. This
 * index moves all field-side transliteration to index time: each row's field
 * variants are computed once (via `searchVariants`) and stored as an
 * {@link IndexedRow}; queries then only transliterate the few query tokens and
 * `scoreVariants` them against the stored field variants — a plain linear scan,
 * sub-100ms at 6k–20k (research-confirmed, no inverted index needed at this
 * scale; that's a Phase 4 add).
 *
 * {@link scoreIndexedRow} / {@link queryIndexedRows} mirror `scoreRow` /
 * `queryRows` exactly — the ONLY difference is field variants come from the
 * stored arrays instead of being recomputed — so ranking is bit-for-bit
 * identical (asserted in the parity test). The index maintains itself
 * incrementally (add / remove / update); unchanged rows are reused, so a
 * library change never re-transliterates the whole library.
 */

import {
  type IndexableRow,
  isEmptyTokens,
  parseSearchTokens,
  type QueryHit,
  type SearchTokens,
} from "@/lib/search-core";
import { NO_MATCH_SCORE, scoreVariants, searchVariants } from "@/lib/search-transliterate";

/** A row reduced to the precomputed search variants of each scoped field. */
export interface IndexedRow {
  id: string;
  /** Variant sets for each free-scope field (title, caption, note, tags, …). */
  free: readonly (readonly string[])[];
  /** Variant sets for each artist-scope field. */
  artist: readonly (readonly string[])[];
  /** Variant sets for each album-scope field. */
  album: readonly (readonly string[])[];
  /** Variant sets for each tag. */
  tags: readonly (readonly string[])[];
}

/** Variant sets for a field list, dropping fields that produce no variants. */
function variantsForFields(fields: readonly string[]): string[][] {
  const out: string[][] = [];
  for (const field of fields) {
    if (!field) continue;
    const variants = searchVariants(field);
    if (variants.length > 0) out.push([...variants]);
  }
  return out;
}

/** Precompute every field's search variants once (the index-time transliteration). */
export function buildIndexedRow(row: IndexableRow): IndexedRow {
  return {
    id: row.id,
    free: variantsForFields(row.free),
    artist: variantsForFields(row.artist),
    album: variantsForFields(row.album),
    tags: variantsForFields(row.tags),
  };
}

/**
 * Sum of per-token best scores over precomputed field variants, or
 * `NO_MATCH_SCORE` if any token is unmatched. Mirrors `search-core`'s
 * `scopeScore`→`bestTokenScore`, but the field variants are already computed.
 */
function scopeScoreVariants(
  tokens: readonly string[],
  fields: readonly (readonly string[])[],
): number {
  let total = 0;
  for (const token of tokens) {
    const queryVariants = searchVariants(token);
    let best = NO_MATCH_SCORE;
    for (const fieldVariants of fields) {
      const score = scoreVariants(queryVariants, fieldVariants);
      if (score < best) best = score;
      if (best === 0) break; // can't beat exact
    }
    if (best >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
    total += best;
  }
  return total;
}

/**
 * Relevance score for a precomputed row against parsed tokens (lower = better).
 * Identical semantics to `search-core`'s `scoreRow`: 0 for an empty query,
 * `NO_MATCH_SCORE` when any token's scope has no match, otherwise the summed
 * best score capped just below the sentinel.
 */
export function scoreIndexedRow(row: IndexedRow, tokens: SearchTokens): number {
  if (isEmptyTokens(tokens)) return 0;
  const free = scopeScoreVariants(tokens.free, row.free);
  if (free >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
  const artist = scopeScoreVariants(tokens.artist, row.artist);
  if (artist >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
  const album = scopeScoreVariants(tokens.album, row.album);
  if (album >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
  const tags = scopeScoreVariants(tokens.tags, row.tags);
  if (tags >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
  return Math.min(free + artist + album + tags, NO_MATCH_SCORE - 1);
}

/**
 * Filter + rank precomputed rows by query relevance (best match first; stable
 * for ties via iteration order). Mirrors `queryRows`: an empty query returns
 * every row in order with score 0.
 */
export function queryIndexedRows(rows: Iterable<IndexedRow>, query: string): QueryHit[] {
  const list = Array.isArray(rows) ? (rows as IndexedRow[]) : [...rows];
  if (!query.trim()) return list.map((row) => ({ id: row.id, score: 0 }));
  const tokens = parseSearchTokens(query);
  return list
    .map((row, index) => ({ id: row.id, index, score: scoreIndexedRow(row, tokens) }))
    .filter((entry) => entry.score < NO_MATCH_SCORE)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => ({ id: entry.id, score: entry.score }));
}

/** Counts returned by {@link SearchIndex.setRows} for logging / verification. */
export interface SetRowsDelta {
  added: number;
  updated: number;
  removed: number;
  reused: number;
}

/** A self-maintaining precomputed-variant index over `IndexableRow`s. */
export interface SearchIndex {
  /** Diff a fresh snapshot against the current index, rebuilding only the delta. */
  setRows(rows: readonly IndexableRow[]): SetRowsDelta;
  /** Add or replace a single row. */
  addRow(row: IndexableRow): void;
  /** Drop a row by id (no-op if absent). */
  removeRow(id: string): void;
  /** Replace a single row's indexed variants. */
  updateRow(row: IndexableRow): void;
  /** Ranked hits for a query (best first). */
  query(query: string): QueryHit[];
  /** Number of indexed rows. */
  size(): number;
}

/** True when two source rows have identical scoped field arrays (no rebuild needed). */
function sameSource(a: IndexableRow, b: IndexableRow): boolean {
  return (
    sameArray(a.free, b.free) &&
    sameArray(a.artist, b.artist) &&
    sameArray(a.album, b.album) &&
    sameArray(a.tags, b.tags)
  );
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Create an empty index. Insertion order is preserved (Map), so a fresh
 * `setRows(array)` ranks ties in the same order as `queryRows(array)`.
 */
export function createSearchIndex(): SearchIndex {
  // id → { source row (for cheap diffing), precomputed indexed row }.
  const entries = new Map<string, { source: IndexableRow; indexed: IndexedRow }>();

  const put = (row: IndexableRow): void => {
    entries.set(row.id, { source: row, indexed: buildIndexedRow(row) });
  };

  return {
    setRows(rows: readonly IndexableRow[]): SetRowsDelta {
      const delta: SetRowsDelta = { added: 0, updated: 0, removed: 0, reused: 0 };
      const seen = new Set<string>();
      for (const row of rows) {
        seen.add(row.id);
        const existing = entries.get(row.id);
        if (!existing) {
          put(row);
          delta.added += 1;
        } else if (sameSource(existing.source, row)) {
          delta.reused += 1;
        } else {
          put(row);
          delta.updated += 1;
        }
      }
      for (const id of entries.keys()) {
        if (!seen.has(id)) {
          entries.delete(id);
          delta.removed += 1;
        }
      }
      return delta;
    },
    addRow(row: IndexableRow): void {
      put(row);
    },
    removeRow(id: string): void {
      entries.delete(id);
    },
    updateRow(row: IndexableRow): void {
      put(row);
    },
    query(query: string): QueryHit[] {
      const rows: IndexedRow[] = [];
      for (const entry of entries.values()) rows.push(entry.indexed);
      return queryIndexedRows(rows, query);
    },
    size(): number {
      return entries.size;
    },
  };
}
