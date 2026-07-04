import type { MuzeroDB } from "@/db/muzero-db";
import {
  getAllEnrichmentGenres,
  getPlayQueue,
  getSession,
  getTrack,
  onTrackTagsEdited,
} from "@/db/repositories";
import { type DjChatLocalIdRegistry, encodeSetRef, encodeTrackRef } from "./dj-chat-local-ids";
import {
  applyTagEditToCounts,
  computeFacetCounts,
  type FacetCounts,
  topFacets,
} from "./library-facets";

/** Cap per dimension in the prompt block — conveys the palette without bloating the prompt. */
const FACETS_PROMPT_LIMIT = 50;

/**
 * A compact snapshot of what the listener is playing right now — the active 歌单
 * (set) and current track, each with its id — injected into the system prompt
 * every turn (see {@link createDjChatTransport}). It means the DJ always knows the
 * current context and can act on it (curate into the set, switch the track,
 * continue the vibe) without burning a `now_playing_get` tool call. Empty-safe.
 */
export async function buildNowPlayingContext(
  db: MuzeroDB,
  localIds?: DjChatLocalIdRegistry,
): Promise<string> {
  const queue = await getPlayQueue(db);
  const total = queue.entries.length;
  if (total === 0) return "Now playing: nothing — the play queue is empty.";

  const index = Math.min(Math.max(queue.currentIndex, 0), total - 1);
  const currentId = queue.entries[index]?.trackId;
  const [track, set] = await Promise.all([
    currentId ? getTrack(currentId, db) : Promise.resolve(undefined),
    queue.contextSetId ? getSession(queue.contextSetId, db) : Promise.resolve(undefined),
  ]);

  const lines = ["Now playing (live context — you can reference these ids directly):"];
  if (set) {
    const setRef = localIds ? encodeSetRef(set.id, localIds) : set.id;
    lines.push(
      `- Playing-from set (歌单): "${set.name.trim() || "Untitled set"}" (id: ${setRef}, ${set.trackIds.length} tracks).`,
    );
  }
  if (track) {
    const trackRef = localIds
      ? encodeTrackRef(track.id, localIds, set ? { setId: set.id } : undefined)
      : track.id;
    lines.push(
      `- Current track: "${track.title.trim() || "Untitled"}" (id: ${trackRef}), position ${index + 1} of ${total} in the queue.`,
    );
  } else {
    lines.push(`- Queue has ${total} tracks; currently at position ${index + 1}.`);
  }
  return lines.join("\n");
}

/**
 * A one-line awareness hint that the listener HAS existing 歌单, so the DJ checks
 * (via the searchable, paginated `set_list` tool) to REUSE one before creating a
 * near-duplicate — instead of dumping every set name into the prompt each turn
 * (which doesn't scale to large libraries). Empty string when there are no sets.
 */
export async function buildSetsContext(db: MuzeroDB): Promise<string> {
  const count = await db.sessions.count();
  if (count === 0) return "";
  return `You have ${count} saved set(s) (歌单). Before creating a new set, call set_list (optionally with a name query) to find an existing one to REUSE with set_add_tracks — don't make near-duplicates, and never leave a set empty.`;
}

/**
 * Cached palette per DB. Recomputing the full-library scan every DJ turn is wasted disk I/O
 * (the library rarely changes mid-chat), so we memoize the full genre/tag COUNT MAPS + the
 * derived block, and invalidate cheaply:
 *  - track + enrichment row COUNTS fingerprint (`count()` reads IndexedDB key stats without
 *    deserializing rows) → a genuine change (add/remove a track, auto-enrich/sweep writing a
 *    row) triggers a full rebuild;
 *  - a tag EDIT on an existing track moves no count, so instead of forcing a rescan we update
 *    the cached tag counts INCREMENTALLY from the (old,new) delta (see the listener below) and
 *    re-derive the block — O(changed tags), never a scan.
 *
 * Deliberately in-memory, NOT a persisted materialized aggregate: a rebuild only happens on a
 * real add/remove/enrich (or first turn), negligible against LLM latency, while the frequent
 * case (tagging songs) never scans. Recompute-from-source on any count change means the
 * incremental tag counts can't permanently DRIFT (they reset on the next add/remove/enrich) —
 * the property this codebase protects by keeping counts off the track row (switch-fps). Keyed
 * by DB (WeakMap) so tests with isolated DBs don't cross-contaminate.
 */
interface CachedPalette extends FacetCounts {
  fingerprint: string;
  block: string;
}
const paletteCache = new WeakMap<MuzeroDB, CachedPalette>();

/** Derive the injected block from the count maps (top-N per dimension). "" when both are empty. */
function formatPaletteBlock(counts: FacetCounts): string {
  const genres = topFacets(counts.genreCounts, FACETS_PROMPT_LIMIT);
  const tags = topFacets(counts.tagCounts, FACETS_PROMPT_LIMIT);
  if (genres.length === 0 && tags.length === 0) return "";
  const lines = [
    "Library palette — the genres and tags the listener's library ACTUALLY contains right now (number = tracks). Curate/filter using these exact names; don't invent genres the library lacks. For a genre/mood request, library_search these names, then keep only the songs that truly fit:",
  ];
  if (genres.length > 0) {
    lines.push(`- Genres: ${genres.map((g) => `${g.name} (${g.count})`).join(", ")}`);
  }
  if (tags.length > 0) {
    lines.push(`- Tags: ${tags.map((t) => `#${t.name} (${t.count})`).join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * The "library palette" — the distinct genres + listener tags actually present in the library,
 * with per-genre/tag track counts, injected every turn so the DJ curates from what EXISTS
 * (e.g. "放点 city pop" → it knows there are 34) instead of guessing or inventing genres the
 * library doesn't have. Genre = file genres ∪ enrichment; both dimensions capped to the top
 * {@link FACETS_PROMPT_LIMIT} by count. Empty string when the library has no genres/tags yet.
 * Memoized (see {@link paletteCache}) so it only rescans on a real change, and a tag edit
 * updates it incrementally with no scan at all.
 */
export async function buildLibraryFacetsContext(db: MuzeroDB): Promise<string> {
  // Fingerprint = in-memory mutation revision (add/remove track, enrichment change) — an instant
  // integer read, NOT a per-turn `db.count()` query (which is slow right after a write). A tag
  // edit doesn't bump it (it's applied incrementally by the listener below), so tagging a song
  // never forces this rebuild. See MuzeroDB.libraryMutationRevision.
  const fingerprint = String(db.libraryMutationRevision());
  const cached = paletteCache.get(db);
  if (cached && cached.fingerprint === fingerprint) return cached.block;

  const [tracks, enrichmentGenres] = await Promise.all([
    db.tracks.toArray(),
    getAllEnrichmentGenres(db),
  ]);
  const counts = computeFacetCounts(tracks, enrichmentGenres);
  const block = formatPaletteBlock(counts);
  paletteCache.set(db, { ...counts, fingerprint, block });
  return block;
}

// Incremental tag-edit update: adjust the cached tag counts + re-derive the block WITHOUT a
// full rescan (the frequent case — tagging songs). No-op when nothing is cached for that DB
// yet (the next build computes fresh) or when the edit didn't change the top-N block text.
// Registered once at module load; per-DB via the cache's WeakMap key.
onTrackTagsEdited(({ db, oldTags, newTags }) => {
  const cached = paletteCache.get(db);
  if (!cached) return;
  applyTagEditToCounts(cached.tagCounts, oldTags, newTags);
  cached.block = formatPaletteBlock(cached);
});
