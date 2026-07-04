import type { MuzeroDB } from "@/db/muzero-db";
import {
  getAllEnrichmentGenres,
  getPlayQueue,
  getSession,
  getTrack,
  getTrackTagsRevision,
} from "@/db/repositories";
import { type DjChatLocalIdRegistry, encodeSetRef, encodeTrackRef } from "./dj-chat-local-ids";
import { computeFacets } from "./library-facets";

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
 * Cached palette block per DB. Recomputing the full-library scan every DJ turn is wasted disk
 * I/O (the library rarely changes mid-chat), so we memoize and invalidate on a CHEAP fingerprint:
 *  - track + enrichment row COUNTS — `count()` reads IndexedDB key stats without deserializing
 *    rows, and moves on add / remove a track and auto-enrich / sweep writing an enrichment row;
 *  - the tag-edit revision ({@link getTrackTagsRevision}) — a tag edit on an existing track moves
 *    no count, so `setTrackTags` bumps this instead → an edited tag shows in the palette at once.
 * Together these cover every palette-relevant change.
 *
 * Deliberately in-memory, NOT a persisted materialized aggregate: recomputing once per app
 * session (first chat turn) is negligible against LLM latency, whereas a persisted incremental
 * count store would have to hook every write path and risks the denormalized-count DRIFT this
 * codebase moved playCount/liked OFF the track row to avoid (switch-fps). Recompute-from-source
 * can't drift. Keyed by DB (WeakMap) so tests with isolated DBs don't cross-contaminate.
 */
const facetsBlockCache = new WeakMap<MuzeroDB, { fingerprint: string; block: string }>();

/**
 * The "library palette" — the distinct genres + listener tags actually present in the library,
 * with per-genre/tag track counts, injected every turn so the DJ curates from what EXISTS
 * (e.g. "放点 city pop" → it knows there are 34) instead of guessing or inventing genres the
 * library doesn't have. Genre = file genres ∪ enrichment; both dimensions capped to the top
 * {@link FACETS_PROMPT_LIMIT} by count. Empty string when the library has no genres/tags yet.
 * Memoized on a count fingerprint (see {@link facetsBlockCache}) so it only rescans on change.
 */
export async function buildLibraryFacetsContext(db: MuzeroDB): Promise<string> {
  const [trackCount, enrichmentCount] = await Promise.all([
    db.tracks.count(),
    db.enrichments.count(),
  ]);
  // Counts catch add/remove/enrich; the tag revision catches tag EDITS on existing tracks
  // (which don't move any count). Together they invalidate on every palette-relevant change.
  const fingerprint = `${trackCount}:${enrichmentCount}:${getTrackTagsRevision(db)}`;
  const cached = facetsBlockCache.get(db);
  if (cached && cached.fingerprint === fingerprint) return cached.block;

  const block = await computeLibraryFacetsBlock(db, trackCount);
  facetsBlockCache.set(db, { fingerprint, block });
  return block;
}

async function computeLibraryFacetsBlock(db: MuzeroDB, trackCount: number): Promise<string> {
  if (trackCount === 0) return "";
  const [tracks, enrichmentGenres] = await Promise.all([
    db.tracks.toArray(),
    getAllEnrichmentGenres(db),
  ]);
  const { genres, tags } = computeFacets(tracks, enrichmentGenres, { limit: FACETS_PROMPT_LIMIT });
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
