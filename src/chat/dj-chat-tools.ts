import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import {
  addMemory,
  createPendingTrack,
  createSession,
  getAllTags,
  getEnrichmentsByTrackIds,
  getPlayQueue,
  getSession,
  getSettings,
  getTracksByIds,
  listAllLyrics,
  listAllMemories,
  listAllTracks,
  listSessions,
  memoryNotesByTrack,
  playQueueAppend,
  playQueuePlayNext,
  playQueueSet,
  playQueueSetRepeat,
  prependTrackIds,
  updateSession,
} from "@/db/repositories";
import type { DjSession, PlayQueue, Track, TrackEnrichment } from "@/db/types";
import { describeBrief, type TrackBrief, trackBriefSchema } from "@/dj/dj-brief-schema";
import { newId } from "@/lib/id";
import { freeTextMatches } from "@/lib/search-core";
import { findLyricSearchMatch, lyricsSearchFields, searchTracks } from "@/lib/track-search";
import {
  generatedTrackMemoryNote,
  musicGenProviderPresetKey,
  musicGenProviderPresetKeyFromSettings,
} from "@/musicgen/provenance";
import { orderedSetTrackIds } from "@/player/set-order";
import type { StreamSearchHit } from "@/streamsrc/provider";
import { resolveEnabledStreamSources, type StreamSourceDeps } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";
import { addHitsToSet } from "@/streamsrc/streamed-track-repo";
import { normalizeReplyParts, plainReplyText, type ReplyPart } from "@/tts/emotion-markup";
import { executeLibraryTree, libraryTreeInputSchema } from "./dj-chat-library-tree";
import {
  type DjChatLocalIdRegistry,
  encodeMemoryRef,
  encodeQueueEntryRef,
  encodeResultRef,
  encodeSetRef,
  encodeTrackRef,
  resolveSetRef,
  resolveTrackRef,
  UnknownDjChatLocalIdError,
  WrongDjChatLocalIdTypeError,
} from "./dj-chat-local-ids";
import { toolDescription } from "./dj-chat-tool-descriptions";
import { type DjReplyEvent, emitDjReply } from "./dj-reply-bus";
import { computeFacets, type LibraryFacets } from "./library-facets";

export const agentWriteResultSchema = z.object({
  status: z.enum(["ok", "error"]),
  commandId: z.string(),
  summary: z.string(),
  diff: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()).default([]),
});

export type AgentWriteResult = z.infer<typeof agentWriteResultSchema>;

/** Fields the agent can project in search results — keep payloads small. */
export const TRACK_RESULT_FIELDS = [
  "id",
  "title",
  "artist",
  "album",
  "tags",
  "genre",
  "durationSec",
  "origin",
  "kind",
  "liked",
  "playCount",
] as const;
export type TrackResultField = (typeof TRACK_RESULT_FIELDS)[number];

export const searchTracksInputSchema = z.object({
  /** One or more keywords; each is matched independently (combined per `match`). */
  queries: z.array(z.string().min(1)).max(8).optional(),
  /** Single-keyword convenience (merged with `queries`). */
  query: z.string().optional(),
  /** "any" = a track matching ANY keyword (gather a genre); "all" = ALL keywords. */
  match: z.enum(["any", "all"]).default("any"),
  /** Which fields to return per track. Default ["id","title"] to keep JSON tiny. */
  fields: z.array(z.enum(TRACK_RESULT_FIELDS)).optional(),
  /** Cap returned rows (the full match count is reported as `total`). */
  limit: z.number().int().min(1).max(500).default(30),
  /** Page offset into the matches; pass the previous call's `nextCursor` to page. */
  cursor: z.number().int().min(0).default(0),
});

export type SearchTracksInput = z.input<typeof searchTracksInputSchema>;

/** Project a Track to only the requested fields (artist/album derived from metadata). */
function projectTrack(
  track: Track,
  fields: readonly TrackResultField[],
  deps: LocalIdDeps = {},
  // playCount is sourced from trackPlaybackStats, not the track row (switch-fps:
  // it's no longer denormalized onto `tracks`). Caller passes a per-track sum.
  playCountByTrack?: Map<string, number>,
  // `liked` likewise moved to the trackLikes side table (PRD scalable-track-list);
  // caller passes the liked-id set for the page.
  likedByTrack?: ReadonlySet<string>,
  // `genre` = file-parsed genres ∪ external enrichment (its own table); caller passes the map.
  enrichmentGenreByTrack?: ReadonlyMap<string, readonly string[]>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const f of fields) {
    if (f === "artist") row.artist = track.mediaMetadata?.artists?.[0] ?? track.streamMeta?.artist;
    else if (f === "album") row.album = track.mediaMetadata?.album ?? track.streamMeta?.album;
    else if (f === "id") row.id = encodeMaybeTrack(track.id, deps);
    else if (f === "playCount") row.playCount = playCountByTrack?.get(track.id) ?? 0;
    else if (f === "liked") row.liked = likedByTrack?.has(track.id) ?? false;
    else if (f === "genre") {
      row.genre = Array.from(
        new Set([
          ...(track.mediaMetadata?.genres ?? []),
          ...(enrichmentGenreByTrack?.get(track.id) ?? []),
        ]),
      );
    } else row[f] = track[f as keyof Track];
  }
  return row;
}

/** Sum playCount per track from trackPlaybackStats (across devices) for a set of
 *  ids — the authoritative source now that `tracks.playCount` is gone (switch-fps). */
async function sumPlayCountsByTrack(ids: string[], db: MuzeroDB): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const rows = await db.trackPlaybackStats.where("trackId").anyOf(ids).toArray();
  for (const row of rows) map.set(row.trackId, (map.get(row.trackId) ?? 0) + row.playCount);
  return map;
}

/** The liked subset of `ids`, from the trackLikes side table (authoritative now that
 *  `tracks.liked` is gone — PRD scalable-track-list). */
async function likedSetForTracks(ids: string[], db: MuzeroDB): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.trackLikes.where("trackId").anyOf(ids).toArray();
  return new Set(rows.map((r) => r.trackId));
}

/** `trackId → external genre/style` for search — folds enrichment into the library-search
 *  corpus so the agent can filter imported tracks by fetched genre (PM's "过滤导入歌曲"). */
function enrichmentGenresByTrackIdMap(
  rows: ReadonlyMap<string, TrackEnrichment>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, e] of rows) {
    if (e.status !== "found") continue;
    const genres = [...e.genres, ...(e.styles ?? [])];
    if (genres.length > 0) out.set(id, genres);
  }
  return out;
}

/** Multi-keyword search: per-term match, combined by union ("any") or intersection ("all"). */
function searchMultiTerm(
  tracks: Track[],
  terms: string[],
  match: "any" | "all",
  notes?: ReadonlyMap<string, readonly string[]>,
  genres?: ReadonlyMap<string, readonly string[]>,
): Track[] {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return tracks;
  if (cleaned.length === 1) return searchTracks(tracks, cleaned[0], notes, genres);
  const perTerm = cleaned.map(
    (t) => new Set(searchTracks(tracks, t, notes, genres).map((x) => x.id)),
  );
  return tracks.filter((t) =>
    match === "all" ? perTerm.every((s) => s.has(t.id)) : perTerm.some((s) => s.has(t.id)),
  );
}

export const generateTracksInputSchema = z.object({
  sessionId: z.string().min(1),
  briefs: z.array(trackBriefSchema).min(1).max(4),
  playNext: z.boolean().default(true),
});

export type GenerateTracksInput = z.input<typeof generateTracksInputSchema>;

export const proposeBriefsInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  rationale: z.string().max(1000).optional(),
  briefs: z.array(trackBriefSchema).min(1).max(4),
});

export type ProposeBriefsInput = z.input<typeof proposeBriefsInputSchema>;

const streamSourceEnum = z.enum(["netease", "bili", "youtube", "qq"]);

const streamHitSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  source: streamSourceEnum,
  artist: z.string().optional(),
  album: z.string().optional(),
  durationSec: z.number().optional(),
  coverUrl: z.string().optional(),
});

export const onlineSearchInputSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(30).default(12),
  /** Restrict to a subset of the enabled sources; default = all enabled. */
  sources: z.array(streamSourceEnum).optional(),
});

export type OnlineSearchInput = z.input<typeof onlineSearchInputSchema>;

export const onlineAddInputSchema = z.object({
  sessionId: z.string().min(1),
  hits: z.array(streamHitSchema).min(1).max(50),
});

export type OnlineAddInput = z.input<typeof onlineAddInputSchema>;

export const setAddTracksInputSchema = z.object({
  sessionId: z.string().min(1),
  trackIds: z.array(z.string().min(1)).min(1).max(200),
});

export type SetAddTracksInput = z.input<typeof setAddTracksInputSchema>;

export const createSetInputSchema = z.object({
  name: z.string().max(80).optional(),
  seedPrompt: z.string().default(""),
  autoExtend: z.boolean().default(false),
  /** Existing local track ids to seed the new set with, in this order (optional). */
  trackIds: z.array(z.string().min(1)).max(500).optional(),
});

export type CreateSetInput = z.input<typeof createSetInputSchema>;

export const memorySearchInputSchema = z.object({
  /** One or more keywords matched against the memory note + its track title/tags. */
  queries: z.array(z.string().min(1)).min(1).max(8),
  /** "any" = a memory matching ANY keyword; "all" = ALL keywords. */
  match: z.enum(["any", "all"]).default("any"),
  limit: z.number().int().min(1).max(200).default(50),
});

export type MemorySearchInput = z.input<typeof memorySearchInputSchema>;

export const addMemoryInputSchema = z.object({
  /** Target local track. Omit to attach to whatever is playing right now. */
  trackId: z.string().min(1).optional(),
  note: z.string().min(1).max(2000),
});

export type AddMemoryInput = z.input<typeof addMemoryInputSchema>;

export const LIBRARY_SEARCH_TYPES = ["track", "set", "lyrics"] as const;
export type LibrarySearchType = (typeof LIBRARY_SEARCH_TYPES)[number];

export const librarySearchInputSchema = z.object({
  /** One or more keywords; combined per `match`. */
  queries: z.array(z.string().min(1)).min(1).max(8),
  /** "any" = matching ANY keyword (gather a genre); "all" = ALL keywords. */
  match: z.enum(["any", "all"]).default("any"),
  /** Result types to include. Default just tracks. "lyrics" finds songs by their words. */
  types: z.array(z.enum(LIBRARY_SEARCH_TYPES)).min(1).default(["track"]),
  /** Track-group field projection (default id+title to keep JSON small). */
  fields: z.array(z.enum(TRACK_RESULT_FIELDS)).optional(),
  /** Per-group cap; the track group also pages via `cursor` (reports `nextCursor`). */
  limit: z.number().int().min(1).max(200).default(30),
  cursor: z.number().int().min(0).default(0),
});

export type LibrarySearchInput = z.input<typeof librarySearchInputSchema>;

export interface LyricHit {
  trackId: string;
  title: string;
  snippet?: string;
  /** Seconds into the song the matching line is at (synced lyrics only). */
  timeSec?: number;
}

/**
 * Tracks whose lyrics match the terms, reusing the SAME engine as the ⌘F overlay:
 * `freeTextMatches` (transliteration-aware) over the precomputed lyric fields for
 * the matching decision, then `findLyricSearchMatch` for the matched line snippet
 * (+ timestamp). Covers stored lyrics (plain/synced/translation/romanization) and
 * a generated track's brief lyrics; instrumentals are skipped by the matcher.
 */
function searchLyricHits(
  tracks: Track[],
  lyricsByTrack: ReadonlyMap<string, Parameters<typeof findLyricSearchMatch>[1]>,
  terms: string[],
  match: "any" | "all",
): LyricHit[] {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  const hits: LyricHit[] = [];
  for (const track of tracks) {
    const lyrics = lyricsByTrack.get(track.id) ?? null;
    const fields = lyricsSearchFields(track, lyrics);
    if (fields.length === 0) continue;
    const matched =
      cleaned.length === 0
        ? true
        : match === "all"
          ? cleaned.every((t) => freeTextMatches(t, fields))
          : cleaned.some((t) => freeTextMatches(t, fields));
    if (!matched) continue;
    const term = cleaned.find((t) => freeTextMatches(t, fields)) ?? cleaned[0] ?? "";
    const line = findLyricSearchMatch(track, lyrics, term);
    hits.push({
      trackId: track.id,
      title: track.title,
      snippet: line?.text,
      timeSec: line?.timeSec,
    });
  }
  return hits;
}

/** Sets whose NAME matches the terms (transliteration-aware), mirroring ⌘F's `@set`. */
function searchSetHits(
  sessions: DjSession[],
  terms: string[],
  match: "any" | "all",
  deps: LocalIdDeps = {},
): Array<{ id: string; name: string; trackCount: number }> {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  return sessions
    .filter((s) => {
      if (cleaned.length === 0) return true;
      return match === "all"
        ? cleaned.every((t) => freeTextMatches(t, [s.name]))
        : cleaned.some((t) => freeTextMatches(t, [s.name]));
    })
    .map((s) => ({ id: encodeMaybeSet(s.id, deps), name: s.name, trackCount: s.trackIds.length }));
}

/**
 * Playback side-effects the agent can trigger. Kept behind an interface so the
 * tool module stays store-free (testable): the real bridge lazily imports the
 * player-store at call time, tests inject a fake.
 */
export interface PlayerControl {
  /** Load a set into the play queue and start playing from the top (replace). */
  playSet(sessionId: string): Promise<void>;
  /** Switch the currently playing song to a specific local track (play now). */
  playTrack(trackId: string): Promise<void>;
}

async function defaultPlayerControl(db: MuzeroDB): Promise<PlayerControl> {
  const { usePlayerStore } = await import("@/stores/player-store");
  return {
    async playSet(sessionId) {
      const store = usePlayerStore.getState();
      await store.setActiveSession(sessionId);
      await store.play();
    },
    async playTrack(trackId) {
      const [track] = await getTracksByIds([trackId], db);
      if (track) await usePlayerStore.getState().playTrack(track);
    },
  };
}

export interface DjChatToolDeps {
  db?: MuzeroDB;
  providerId?: string;
  /** Offer the paid music-generation tools. Default true (callers gate on `canGenerateMusic`). */
  includeGenerate?: boolean;
  /** Offer the online search/ingest tools. Default false (callers gate on `hasEnabledStreamSources`). */
  includeOnline?: boolean;
  /** Injected stream deps for the online tools (tests stub the providers). */
  streamDeps?: StreamSourceDeps;
  /** Playback bridge for play_set / play_track. Defaults to the live player-store. */
  player?: PlayerControl;
  /** Per-chat-session local-id registry shared by context and tool executions. */
  localIds?: DjChatLocalIdRegistry;
  /** Persist the registry after a tool introduces or resolves local refs. */
  persistLocalIds?: () => Promise<void>;
  /** Sink for `dj_say` replies. Defaults to the module {@link emitDjReply} bus. */
  emitReply?: (event: DjReplyEvent) => void;
  /** UI language (BCP-47) — localizes the LLM-facing tool descriptions to it;
   *  English stays the fallback when a translation is missing. Default English. */
  locale?: string;
}

/** Max length of a spoken `dj_say` reply, summed over parts (kept short — read aloud). */
export const DJ_SAY_MAX_CHARS = 400;

/**
 * `dj_say` execution — the DJ's one channel for talking back. Pure + injectable:
 * it normalizes the reply into parts (each an optional emotion + text), broadcasts
 * it (default the {@link emitDjReply} bus) and returns the standard
 * {@link AgentWriteResult}. Notification uses the plain joined text; the speak path
 * turns per-part emotions into Fish markers. Consumer wiring lives in
 * `use-voice-dj`, keeping this UI-free and testable.
 */
export function executeDjSay(
  input: { say?: ReplyPart[]; text?: string; tone?: DjReplyEvent["tone"] },
  deps: { emit?: (event: DjReplyEvent) => void } = {},
): AgentWriteResult {
  const parts = normalizeReplyParts(input);
  const text = plainReplyText(parts);
  (deps.emit ?? emitDjReply)({ text, parts, tone: input.tone });
  return {
    status: "ok",
    commandId: "muzero.dj.say",
    summary: "Replied to the listener.",
    diff: { text },
    warnings: [],
  };
}

type LocalIdDeps = Pick<DjChatToolDeps, "localIds" | "persistLocalIds"> & {
  resultId?: string;
};

function encodeMaybeTrack(trackId: string, deps: LocalIdDeps, meta?: { setId?: string }): string {
  return deps.localIds ? encodeTrackRef(trackId, deps.localIds, meta) : trackId;
}

function encodeMaybeSet(sessionId: string, deps: LocalIdDeps): string {
  return deps.localIds ? encodeSetRef(sessionId, deps.localIds) : sessionId;
}

function encodeMaybeMemory(memoryId: string, deps: LocalIdDeps): string {
  return deps.localIds ? encodeMemoryRef(memoryId, deps.localIds) : memoryId;
}

function encodeMaybeQueueEntry(entryId: string, deps: LocalIdDeps): string {
  return deps.localIds ? encodeQueueEntryRef(entryId, deps.localIds) : entryId;
}

function resolveMaybeTrack(trackId: string, deps: LocalIdDeps): string {
  return deps.localIds ? resolveTrackRef(trackId, deps.localIds) : trackId;
}

function resolveMaybeSet(sessionId: string, deps: LocalIdDeps): string {
  return deps.localIds ? resolveSetRef(sessionId, deps.localIds) : sessionId;
}

function resultRef(toolName: string, deps: LocalIdDeps, summary?: Record<string, unknown>) {
  if (!deps.localIds) return undefined;
  return encodeResultRef(deps.resultId ?? newId("res"), deps.localIds, {
    resultSummary: summary,
    toolName,
  });
}

async function persistLocalIds(deps: LocalIdDeps): Promise<void> {
  await deps.persistLocalIds?.();
}

function localIdResolutionErrorResult(error: unknown): AgentWriteResult | undefined {
  if (error instanceof UnknownDjChatLocalIdError) {
    return {
      status: "error",
      commandId: "muzero.local_id.resolve",
      summary: `${error.localId} is not available in this chat context. Refresh with library_tree, library_search, set_list, set_get, now_playing_get, or memory_search, then use the returned local id.`,
      diff: { localId: error.localId, reason: "unknown-local-id" },
      warnings: ["unknown-local-id"],
    };
  }

  if (error instanceof WrongDjChatLocalIdTypeError) {
    const expectedHint =
      error.expected === "T"
        ? "#T"
        : error.expected === "S"
          ? "#S"
          : error.expected === "M"
            ? "#M"
            : error.expected === "Q"
              ? "#Q"
              : "#R";
    return {
      status: "error",
      commandId: "muzero.local_id.resolve",
      summary: `${error.localId} is a ${error.actual ?? "raw"} ref, but this tool needs ${error.expected}. Use an entity id such as ${expectedHint} from a recent tool result; do not use resultRef ids like #R for entity actions.`,
      diff: {
        actual: error.actual,
        expected: error.expected,
        localId: error.localId,
        reason: "wrong-local-id-type",
      },
      warnings: ["wrong-local-id-type"],
    };
  }

  return undefined;
}

function withLocalIdErrorHandling<TArgs extends unknown[], TResult>(
  execute: (...args: TArgs) => Promise<TResult> | TResult,
): (...args: TArgs) => Promise<TResult | AgentWriteResult> {
  return async (...args) => {
    try {
      return await execute(...args);
    } catch (error) {
      const result = localIdResolutionErrorResult(error);
      if (result) return result;
      throw error;
    }
  };
}

function withOrdinal<T extends Record<string, unknown>>(
  items: T[],
): Array<T & { ordinal: number }> {
  return items.map((item, index) => ({ ...item, ordinal: index + 1 }));
}

function projectSetForAgent(session: DjSession, deps: LocalIdDeps) {
  return {
    autoExtend: session.config.autoExtend,
    id: encodeMaybeSet(session.id, deps),
    name: session.name,
    trackCount: session.trackIds.length,
    updatedAt: session.updatedAt,
  };
}

export async function executeSearchTracks(
  rawInput: SearchTracksInput,
  deps: { db?: MuzeroDB } & LocalIdDeps = {},
): Promise<{
  total: number;
  returned: number;
  /** Offset to pass as `cursor` for the next page, or null when this is the last. */
  nextCursor: number | null;
  tracks: Array<Record<string, unknown>>;
}> {
  const input = searchTracksInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const tracks = await listAllTracks(db);
  const ids = tracks.map((track) => track.id);
  const notes = await memoryNotesByTrack(ids, db);
  const genres = enrichmentGenresByTrackIdMap(await getEnrichmentsByTrackIds(ids, db));
  const terms = [...(input.queries ?? []), ...(input.query ? [input.query] : [])];
  const matched = searchMultiTerm(tracks, terms, input.match, notes, genres);
  const fields = input.fields?.length ? input.fields : (["id", "title"] as const);
  const page = matched.slice(input.cursor, input.cursor + input.limit);
  const nextOffset = input.cursor + page.length;
  // Only join play counts / liked when the agent asked for them, and only for the page.
  const fieldList = fields as readonly TrackResultField[];
  const pageIds = page.map((track) => track.id);
  const playCountByTrack = fieldList.includes("playCount")
    ? await sumPlayCountsByTrack(pageIds, db)
    : undefined;
  const likedByTrack = fieldList.includes("liked")
    ? await likedSetForTracks(pageIds, db)
    : undefined;
  // `genres` (enrichment) is already computed for the search corpus above — reuse it for the
  // `genre` projection so the agent SEES each track's style, not just filters by it.
  const genreByTrack = fieldList.includes("genre") ? genres : undefined;
  return {
    total: matched.length, // full match count so the agent knows if it's truncated
    returned: page.length,
    nextCursor: nextOffset < matched.length ? nextOffset : null,
    tracks: page.map((track) =>
      projectTrack(track, fields, deps, playCountByTrack, likedByTrack, genreByTrack),
    ),
  };
}

export async function executeGenerateTracks(
  rawInput: GenerateTracksInput,
  deps: DjChatToolDeps = {},
): Promise<
  AgentWriteResult & {
    diff: { createdTrackIds: string[]; sessionId: string; queued: "next" | "append" | "none" };
  }
> {
  const input = generateTracksInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const sessionId = resolveMaybeSet(input.sessionId, deps);
  const session = await getSession(sessionId, db);
  if (!session) {
    return {
      status: "error",
      commandId: "muzero.dj.generate_tracks",
      summary: "Target set was not found.",
      diff: { createdTrackIds: [], sessionId: input.sessionId, queued: "none" },
      warnings: ["missing-session"],
    };
  }

  const settings = deps.providerId ? undefined : await getSettings(db);
  const provider = deps.providerId ?? settings?.musicGenProvider ?? "mock";
  const providerPreset = settings
    ? musicGenProviderPresetKeyFromSettings(settings)
    : musicGenProviderPresetKey({ provider });
  const created: Track[] = [];
  for (const brief of input.briefs) {
    created.push(
      await createPendingTrack(
        {
          sessionId: session.id,
          brief,
          provider,
          providerPreset,
          provenanceMemoryNote: generatedTrackMemoryNote({
            seedPrompt: session.seedPrompt,
            providerPreset,
            brief,
          }),
        },
        db,
      ),
    );
  }
  const ids = created.map((track) => track.id);
  await prependTrackIds(session.id, ids, db);
  if (input.playNext) await playQueuePlayNext(ids, db);
  else await playQueueAppend(ids, db);

  const result = {
    status: "ok",
    commandId: "muzero.dj.generate_tracks",
    summary: `Created ${ids.length} pending track${ids.length === 1 ? "" : "s"}.`,
    diff: {
      createdTrackIds: ids.map((id) => encodeMaybeTrack(id, deps, { setId: session.id })),
      sessionId: encodeMaybeSet(session.id, deps),
      queued: input.playNext ? "next" : "append",
    },
    warnings: [],
  } satisfies AgentWriteResult & {
    diff: { createdTrackIds: string[]; sessionId: string; queued: "append" | "next" | "none" };
  };
  await persistLocalIds(deps);
  return result;
}

export function executeProposeBriefs(rawInput: ProposeBriefsInput): {
  proposalId: string;
  sessionId?: string;
  briefs: TrackBrief[];
  summaries: string[];
  rationale?: string;
} {
  const input = proposeBriefsInputSchema.parse(rawInput);
  return {
    proposalId: newId("prp"),
    sessionId: input.sessionId,
    briefs: input.briefs,
    summaries: input.briefs.map((brief) => `${brief.title}: ${describeBrief(brief)}`),
    rationale: input.rationale?.trim() || undefined,
  };
}

/**
 * Curate: add EXISTING local track ids to a set's membership list (prepend,
 * idempotent). This is how the agent turns search results into a playlist —
 * "gather all my lofi → new set". Only ids that exist as local tracks are added;
 * unknown ids and already-present members are skipped. Free / undoable.
 */
export async function executeSetAddTracks(
  rawInput: SetAddTracksInput,
  deps: { db?: MuzeroDB } & LocalIdDeps = {},
): Promise<AgentWriteResult & { diff: { sessionId: string; added: number; skipped: number } }> {
  const input = setAddTracksInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const sessionId = resolveMaybeSet(input.sessionId, deps);
  const session = await getSession(sessionId, db);
  if (!session) {
    return {
      status: "error",
      commandId: "muzero.set.add_tracks",
      summary: "Target set was not found.",
      diff: { sessionId: input.sessionId, added: 0, skipped: 0 },
      warnings: ["missing-session"],
    };
  }
  const existing = new Set(session.trackIds);
  const trackIds = input.trackIds.map((id) => resolveMaybeTrack(id, deps));
  const present = await getTracksByIds(trackIds, db); // skips ids with no track row
  const toAdd = present.map((t) => t.id).filter((id) => !existing.has(id));
  await prependTrackIds(session.id, toAdd, db);
  const result = {
    status: "ok",
    commandId: "muzero.set.add_tracks",
    summary: `Added ${toAdd.length} track(s) to the set; ${input.trackIds.length - toAdd.length} skipped (unknown or already present).`,
    diff: {
      sessionId: encodeMaybeSet(session.id, deps),
      added: toAdd.length,
      skipped: input.trackIds.length - toAdd.length,
    },
    warnings: [],
  } satisfies AgentWriteResult & { diff: { added: number; sessionId: string; skipped: number } };
  await persistLocalIds(deps);
  return result;
}

/**
 * Curate by query: search the WHOLE local library (no display cap) and add every
 * match to a set in one call. The matched track ids never enter the LLM context —
 * the agent says "make a lofi set" and gets back a count — so this scales to a big
 * library without blowing the token budget. Free / undoable.
 */
/**
 * Create a set and (optionally) populate it with existing local track ids in one
 * call — so "make a playlist with these songs" is a single step instead of
 * create-then-add. Unknown ids are skipped. Returns the new set plus how many
 * tracks landed. Free / undoable.
 */
export async function executeCreateSet(
  rawInput: CreateSetInput,
  deps: { db?: MuzeroDB } & LocalIdDeps = {},
): Promise<DjSession & { addedTrackCount: number }> {
  const input = createSetInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const session = await createSession(
    {
      name: input.name,
      seedPrompt: input.seedPrompt,
      config: { autoExtend: input.autoExtend },
      // The DJ/AI created this set (library origin filter, PRD §12 Phase 12).
      origin: "ai",
    },
    db,
  );
  let added = 0;
  if (input.trackIds?.length) {
    const trackIds = input.trackIds.map((id) => resolveMaybeTrack(id, deps));
    const present = await getTracksByIds(trackIds, db); // skips unknown ids
    await prependTrackIds(
      session.id,
      present.map((t) => t.id),
      db,
    );
    added = present.length;
  }
  const final = (await getSession(session.id, db)) ?? session;
  const result = {
    ...final,
    id: encodeMaybeSet(final.id, deps),
    trackIds: final.trackIds.map((id) => encodeMaybeTrack(id, deps, { setId: final.id })),
    addedTrackCount: added,
  };
  await persistLocalIds(deps);
  return result;
}

/**
 * Search the listener's track memories ("music carries memories") by keyword(s),
 * matching the memory note plus its track's title/tags. Each hit carries the track
 * id + title so the agent can act on the song the memory belongs to. Read-only.
 */
export async function executeMemorySearch(
  rawInput: MemorySearchInput,
  deps: { db?: MuzeroDB } & LocalIdDeps = {},
): Promise<{
  resultRef?: string;
  tool?: "memory_search";
  total: number;
  returned: number;
  memories: Array<{
    memoryId: string;
    note: string;
    createdAt: number;
    trackId: string;
    trackTitle?: string;
    ordinal?: number;
  }>;
}> {
  const input = memorySearchInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const [memories, tracks] = await Promise.all([listAllMemories(db), listAllTracks(db)]);
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const terms = input.queries.map((q) => q.trim().toLowerCase()).filter(Boolean);
  const matched = memories.filter((m) => {
    const track = trackById.get(m.trackId);
    const haystack =
      `${m.note}\n${track?.title ?? ""}\n${(track?.tags ?? []).join(" ")}`.toLowerCase();
    if (terms.length === 0) return true;
    return input.match === "all"
      ? terms.every((t) => haystack.includes(t))
      : terms.some((t) => haystack.includes(t));
  });
  const page = matched.slice(0, input.limit).map((m) => ({
    memoryId: encodeMaybeMemory(m.id, deps),
    note: m.note,
    createdAt: m.createdAt,
    trackId: encodeMaybeTrack(m.trackId, deps),
    trackTitle: trackById.get(m.trackId)?.title,
  }));
  const ref = resultRef("memory_search", deps, { returned: page.length, total: matched.length });
  await persistLocalIds(deps);
  return {
    ...(ref && { resultRef: ref, tool: "memory_search" as const }),
    total: matched.length,
    returned: Math.min(matched.length, input.limit),
    memories: deps.localIds ? withOrdinal(page) : page,
  };
}

/**
 * Attach a memory note to a track. With no trackId it lands on whatever is playing
 * right now — so "remember this one: rainy commute" works mid-listen. Free.
 */
export async function executeAddMemory(
  rawInput: AddMemoryInput,
  deps: { db?: MuzeroDB } & LocalIdDeps = {},
): Promise<AgentWriteResult & { diff: { memoryId?: string; trackId?: string } }> {
  const input = addMemoryInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  let trackId = input.trackId ? resolveMaybeTrack(input.trackId, deps) : undefined;
  if (!trackId) {
    const queue = await getPlayQueue(db);
    const index = Math.min(Math.max(queue.currentIndex, 0), queue.entries.length - 1);
    trackId = queue.entries[index]?.trackId;
  }
  if (!trackId) {
    return {
      status: "error",
      commandId: "muzero.memory.add",
      summary: "No track to attach the memory to — nothing is playing and no trackId was given.",
      diff: {},
      warnings: ["no-track"],
    };
  }
  const [track] = await getTracksByIds([trackId], db);
  if (!track) {
    return {
      status: "error",
      commandId: "muzero.memory.add",
      summary: "That track was not found.",
      diff: { trackId: input.trackId ?? trackId },
      warnings: ["missing-track"],
    };
  }
  const memory = await addMemory({ trackId, note: input.note }, db);
  const result = {
    status: "ok",
    commandId: "muzero.memory.add",
    summary: `Saved a memory on "${track.title}".`,
    diff: {
      memoryId: encodeMaybeMemory(memory.id, deps),
      trackId: encodeMaybeTrack(trackId, deps),
    },
    warnings: [],
  } satisfies AgentWriteResult & { diff: { memoryId?: string; trackId?: string } };
  await persistLocalIds(deps);
  return result;
}

/**
 * ONE search over the library, filterable by type — the agent equivalent of the
 * ⌘F overlay. Reuses the exact same matchers: `searchTracks`/`scoreRow` for tracks,
 * `freeTextMatches` for set names, `findLyricSearchMatch` for lyric lines (all
 * transliteration-aware). Only the requested `types` groups are returned; the
 * track group projects to `fields` and pages via `cursor`/`nextCursor`.
 */
export async function executeLibrarySearch(
  rawInput: LibrarySearchInput,
  deps: { db?: MuzeroDB; onlineAvailable?: boolean } & LocalIdDeps = {},
): Promise<{
  page?: {
    cursor: number;
    nextCursor: number | null;
    returned: number;
    total?: number;
  };
  request?: Record<string, unknown>;
  resultRef?: string;
  tool?: "library_search";
  tracks?: {
    total: number;
    returned: number;
    nextCursor: number | null;
    items: Array<Record<string, unknown>>;
  };
  sets?: {
    total: number;
    items: Array<{ id: string; name: string; ordinal?: number; trackCount: number }>;
  };
  lyrics?: { total: number; items: Array<LyricHit & { ordinal?: number }> };
  /** Set when a track search found NOTHING locally and the user has streaming
   *  sources enabled — the DJ should follow up with online_search_tracks rather
   *  than give up or generate (local-first, then online). */
  onlineFallbackAvailable?: boolean;
}> {
  const input = librarySearchInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const wants = new Set(input.types);
  const out: Awaited<ReturnType<typeof executeLibrarySearch>> = {};

  if (wants.has("track")) {
    const r = await executeSearchTracks(
      {
        queries: input.queries,
        match: input.match,
        fields: input.fields,
        limit: input.limit,
        cursor: input.cursor,
      },
      { db, localIds: deps.localIds },
    );
    out.tracks = {
      total: r.total,
      returned: r.returned,
      nextCursor: r.nextCursor,
      items: deps.localIds ? withOrdinal(r.tracks) : r.tracks,
    };
  }

  if (wants.has("set")) {
    const hits = searchSetHits(await listSessions(db), input.queries, input.match, deps);
    const items = hits.slice(0, input.limit);
    out.sets = { total: hits.length, items: deps.localIds ? withOrdinal(items) : items };
  }

  if (wants.has("lyrics")) {
    const [tracks, lyricsRows] = await Promise.all([listAllTracks(db), listAllLyrics(db)]);
    const lyricsByTrack = new Map(lyricsRows.map((row) => [row.trackId, row]));
    const hits = searchLyricHits(tracks, lyricsByTrack, input.queries, input.match).map((hit) => ({
      ...hit,
      trackId: encodeMaybeTrack(hit.trackId, deps),
    }));
    const items = hits.slice(0, input.limit);
    out.lyrics = { total: hits.length, items: deps.localIds ? withOrdinal(items) : items };
  }

  const trackPage = out.tracks;
  // Local-first, then online: signal an online fallback when a track search came
  // back empty AND the user has streaming sources on. The prompt tells the DJ to
  // call online_search_tracks on this flag instead of stopping or generating.
  if (wants.has("track") && (trackPage?.total ?? 0) === 0 && deps.onlineAvailable) {
    out.onlineFallbackAvailable = true;
  }
  const ref = resultRef("library_search", deps, {
    returned: trackPage?.returned ?? 0,
    total: trackPage?.total,
    types: input.types,
  });
  if (ref) {
    out.resultRef = ref;
    out.tool = "library_search";
    out.request = {
      cursor: input.cursor,
      match: input.match,
      queries: input.queries,
      types: input.types,
    };
    out.page = {
      cursor: input.cursor,
      nextCursor: trackPage?.nextCursor ?? null,
      returned: trackPage?.returned ?? 0,
      total: trackPage?.total,
    };
  }
  await persistLocalIds(deps);
  return out;
}

export const setListInputSchema = z.object({
  /** Keywords over set NAMES; omit/blank = all sets, newest-updated first. */
  query: z.string().optional(),
  /** Page size. */
  limit: z.number().int().min(1).max(100).default(30),
  /** Page offset; pass the previous call's `nextCursor` to page. */
  cursor: z.number().int().min(0).default(0),
});
export type SetListInput = z.input<typeof setListInputSchema>;

export async function executeSetList(
  rawInput: SetListInput = {},
  deps: { db?: MuzeroDB } & LocalIdDeps = {},
): Promise<
  | DjSession[]
  | {
      items: Array<ReturnType<typeof projectSetForAgent> & { ordinal: number }>;
      resultRef: string;
      returned: number;
      tool: "set_list";
      total: number;
      nextCursor: number | null;
    }
> {
  const input = setListInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const query = input.query?.trim() ?? "";
  const all = await listSessions(db); // updatedAt desc
  const matched = query ? all.filter((session) => freeTextMatches(query, [session.name])) : all;
  const page = matched.slice(input.cursor, input.cursor + input.limit);
  if (!deps.localIds) return page;
  const items = withOrdinal(page.map((session) => projectSetForAgent(session, deps)));
  const end = input.cursor + page.length;
  const ref = resultRef("set_list", deps, { returned: items.length, total: matched.length });
  await persistLocalIds(deps);
  return {
    items,
    resultRef:
      ref ??
      encodeResultRef(deps.resultId ?? newId("res"), deps.localIds, {
        toolName: "set_list",
      }),
    returned: items.length,
    tool: "set_list",
    total: matched.length,
    nextCursor: end < matched.length ? end : null,
  };
}

export async function executeSetGet(
  input: { sessionId: string },
  deps: { db?: MuzeroDB } & LocalIdDeps = {},
): Promise<
  | { session: DjSession | undefined; tracks: Track[]; facets: LibraryFacets }
  | {
      request: { sessionId: string };
      resultRef: string;
      set: ReturnType<typeof projectSetForAgent> | undefined;
      tool: "set_get";
      facets: LibraryFacets;
      tracks: Array<Record<string, unknown> & { ordinal: number }>;
    }
> {
  const db = deps.db ?? defaultDb;
  const sessionId = resolveMaybeSet(input.sessionId, deps);
  const session = await getSession(sessionId, db);
  const orderedIds = session ? orderedSetTrackIds(session.trackIds, session.trackRanks) : [];
  const tracks = session ? await getTracksByIds(orderedIds, db) : [];
  // The set's genre/tag makeup (genre = file ∪ enrichment) so the DJ can reason about the
  // playlist's composition — "this set is 60% mandopop" — without paging every track.
  const enrichmentGenres = enrichmentGenresByTrackIdMap(
    await getEnrichmentsByTrackIds(orderedIds, db),
  );
  const facets = computeFacets(tracks, enrichmentGenres);
  if (!deps.localIds) return { session, tracks, facets };
  const ref = resultRef("set_get", deps, { returned: tracks.length, sessionId: input.sessionId });
  await persistLocalIds(deps);
  return {
    request: { sessionId: encodeMaybeSet(sessionId, deps) },
    resultRef:
      ref ?? encodeResultRef(deps.resultId ?? newId("res"), deps.localIds, { toolName: "set_get" }),
    set: session ? projectSetForAgent(session, deps) : undefined,
    tool: "set_get",
    facets,
    tracks: withOrdinal(tracks.map((track) => projectTrack(track, ["id", "title", "kind"], deps))),
  };
}

export async function executeNowPlayingGet(deps: { db?: MuzeroDB } & LocalIdDeps = {}): Promise<
  | PlayQueue
  | {
      contextSetId?: string;
      currentIndex: number;
      entries: Array<{ id: string; ordinal: number; trackId: string }>;
      repeat: PlayQueue["repeat"];
      resultRef: string;
      tool: "now_playing_get";
      updatedAt: number;
    }
> {
  const db = deps.db ?? defaultDb;
  const queue = await getPlayQueue(db);
  if (!deps.localIds) return queue;
  const ref = resultRef("now_playing_get", deps, {
    returned: queue.entries.length,
    total: queue.entries.length,
  });
  const result = {
    ...(queue.contextSetId && { contextSetId: encodeMaybeSet(queue.contextSetId, deps) }),
    currentIndex: queue.currentIndex,
    entries: withOrdinal(
      queue.entries.map((entry) => ({
        id: encodeMaybeQueueEntry(entry.id, deps),
        trackId: encodeMaybeTrack(entry.trackId, deps),
      })),
    ),
    repeat: queue.repeat,
    resultRef:
      ref ??
      encodeResultRef(deps.resultId ?? newId("res"), deps.localIds, {
        toolName: "now_playing_get",
      }),
    tool: "now_playing_get" as const,
    updatedAt: queue.updatedAt,
  };
  await persistLocalIds(deps);
  return result;
}

/**
 * Search the user's ENABLED streaming sources (YouTube / Bilibili / NetEase) for
 * songs. Read-only and cheap — the whole point is that search costs nothing
 * (unlike paid generation), so a locally-hosted LLM can curate from real songs.
 */
export async function executeOnlineSearchTracks(
  rawInput: OnlineSearchInput,
  deps: {
    db?: MuzeroDB;
    streamDeps?: StreamSourceDeps;
    resolveSources?: typeof resolveEnabledStreamSources;
  } = {},
): Promise<{ hits: StreamSearchHit[]; sources: StreamSearchHit["source"][] }> {
  const input = onlineSearchInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const settings = await getSettings(db);
  const streamDeps: StreamSourceDeps = deps.streamDeps ?? {
    http: createStreamHttp(),
    now: () => Date.now(),
    getCookie: (id) => settings.streamSources?.[id]?.cookie,
  };
  const resolve = deps.resolveSources ?? resolveEnabledStreamSources;
  const sources = resolve(settings, streamDeps).filter(
    (s) => !input.sources || input.sources.includes(s.id),
  );
  const results = await Promise.all(
    sources.map((s) =>
      s.search(input.query, { limit: input.limit }).catch(() => [] as StreamSearchHit[]),
    ),
  );
  return { hits: results.flat().slice(0, input.limit), sources: sources.map((s) => s.id) };
}

/**
 * Ingest online search hits into a local set WITHOUT playing them (free, undoable;
 * dedupes by source + external id). The agent passes back hits from a prior
 * `online_search_tracks` call.
 */
export async function executeOnlineAddTracks(
  rawInput: OnlineAddInput,
  deps: { db?: MuzeroDB } & LocalIdDeps = {},
): Promise<AgentWriteResult & { diff: { sessionId: string; added: number; skipped: number } }> {
  const input = onlineAddInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const sessionId = resolveMaybeSet(input.sessionId, deps);
  const session = await getSession(sessionId, db);
  if (!session) {
    return {
      status: "error",
      commandId: "muzero.online.add_tracks",
      summary: "Target set was not found.",
      diff: { sessionId: input.sessionId, added: 0, skipped: 0 },
      warnings: ["missing-session"],
    };
  }
  const { added, skipped } = await addHitsToSet(session.id, input.hits, db);
  const result = {
    status: "ok",
    commandId: "muzero.online.add_tracks",
    summary: `Ingested ${added} track(s) into the set; ${skipped} were already present.`,
    diff: { sessionId: encodeMaybeSet(session.id, deps), added, skipped },
    warnings: [],
  } satisfies AgentWriteResult & { diff: { added: number; sessionId: string; skipped: number } };
  await persistLocalIds(deps);
  return result;
}

export function createDjChatTools(deps: DjChatToolDeps = {}): ToolSet {
  const db = deps.db ?? defaultDb;
  const tools: ToolSet = {
    library_search: tool({
      description:
        'Search the user\'s LOCAL library only (their own imported/generated songs), filtered by `types` (default ["track"]). Results use local ids (#T tracks, #S sets) plus resultRef #R for this result window. Keywords go in `queries` (match "any" gathers a genre, "all" narrows). `types` can include: "track" (title/caption/tags/notes/memories), "set" (match playlist NAMES), and "lyrics" (find songs by lyric words; each hit returns a snippet + timestamp). The track group projects to `fields` (default id+title, add "artist" to judge fit) and pages via `cursor`/`nextCursor`. Always search here FIRST. To curate a genre into a set, judge the results by title/artist and add the ones that fit with set_add_tracks (#T ids). This does NOT search the internet — if it returns nothing (onlineFallbackAvailable in the result) and the listener wants a specific song, follow up with online_search_tracks.',
      inputSchema: librarySearchInputSchema,
      execute: withLocalIdErrorHandling((input, options) =>
        executeLibrarySearch(input, {
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
          onlineAvailable: deps.includeOnline,
          resultId: `result:${options.toolCallId}`,
        }),
      ),
    }),
    library_tree: tool({
      description:
        'Browse the user library as a tree using short local ids. Use scope "library" for all sets plus unassigned songs, scope "set" with a #S id to inspect one set, or scope "unassigned" to organize songs not in any set. Results are paged with cursor/nextCursor and include resultRef plus per-result ordinals; actions should use entity ids like #T1/#S1.',
      inputSchema: libraryTreeInputSchema,
      execute: withLocalIdErrorHandling((input, options) =>
        executeLibraryTree(input, {
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
          resultId: `result:${options.toolCallId}`,
        }),
      ),
    }),
    library_list_tags: tool({
      description: "List distinct local tags with usage counts.",
      inputSchema: z.object({}),
      execute: () => getAllTags(db),
    }),
    now_playing_get: tool({
      description:
        "Read the current play queue and playing-from set context. Returns a resultRef #R plus local #Q queue entries, #T track refs, and #S context set refs.",
      inputSchema: z.object({}),
      execute: withLocalIdErrorHandling((_input, options) =>
        executeNowPlayingGet({
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
          resultId: `result:${options.toolCallId}`,
        }),
      ),
    }),
    set_list: tool({
      description:
        "Find/list local sets (歌单). Optional `query` matches set NAMES (omit/blank = all sets, newest-updated first). Paged via `cursor`/`limit` — if `nextCursor` is non-null, call again with cursor set to it. Returns compact #S set refs in a resultRef #R window. Use this to find an existing set to REUSE (set_add_tracks) before creating a near-duplicate.",
      inputSchema: setListInputSchema,
      execute: withLocalIdErrorHandling((input, options) =>
        executeSetList(input, {
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
          resultId: `result:${options.toolCallId}`,
        }),
      ),
    }),
    set_get: tool({
      description:
        "Read one local set by #S id and its ordered tracks. Returns the set as #S and tracks as #T inside a resultRef #R window.",
      inputSchema: z.object({ sessionId: z.string().min(1) }),
      execute: withLocalIdErrorHandling((input, options) =>
        executeSetGet(input, {
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
          resultId: `result:${options.toolCallId}`,
        }),
      ),
    }),
    set_create: tool({
      description:
        "Create a local set, optionally seeding it with existing #T track ids (in order) so 'make a playlist with these songs' is one call. Returns the new set as #S. A seeded DJ set can auto-extend; curated/upload sets should not.",
      inputSchema: createSetInputSchema,
      execute: withLocalIdErrorHandling((input) =>
        executeCreateSet(input, {
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
        }),
      ),
    }),
    set_update: tool({
      description:
        "Update free set metadata such as name or seed prompt. Pass the target set as #S.",
      inputSchema: z.object({
        sessionId: z.string().min(1),
        name: z.string().max(80).optional(),
        seedPrompt: z.string().optional(),
      }),
      execute: withLocalIdErrorHandling(async ({ sessionId, name, seedPrompt }) => {
        const realSessionId = resolveMaybeSet(sessionId, deps);
        await updateSession(realSessionId, { name, seedPrompt }, db);
        await persistLocalIds(deps);
        return {
          status: "ok",
          commandId: "muzero.set.update",
          summary: "Updated set.",
          diff: { sessionId: encodeMaybeSet(realSessionId, deps) },
          warnings: [],
        } satisfies AgentWriteResult;
      }),
    }),
    set_add_tracks: tool({
      description:
        "Add existing #T track ids to a #S set. Works on ANY set: an existing one from set_list/set_get or a freshly created one. Idempotent; only known local tracks are added. Use for a hand-picked few ids.",
      inputSchema: setAddTracksInputSchema,
      execute: withLocalIdErrorHandling((input) =>
        executeSetAddTracks(input, {
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
        }),
      ),
    }),
    set_switch: tool({
      description:
        "Load a #S set's tracks into the playback queue and return an encoded queue summary.",
      inputSchema: z.object({
        sessionId: z.string().min(1),
        currentIndex: z.number().int().min(0).default(0),
      }),
      execute: withLocalIdErrorHandling(async ({ sessionId, currentIndex }) => {
        const realSessionId = resolveMaybeSet(sessionId, deps);
        const session = await getSession(realSessionId, db);
        if (!session) return undefined;
        await playQueueSet(session.trackIds, { currentIndex, contextSetId: session.id }, db);
        return executeNowPlayingGet({
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
          resultId: `result:set_switch:${session.id}`,
        });
      }),
    }),
    queue_add: tool({
      description:
        "Add #T track ids to the play queue, either next or appended, and return an encoded queue summary.",
      inputSchema: z.object({
        trackIds: z.array(z.string().min(1)).min(1).max(50),
        position: z.enum(["next", "append"]).default("append"),
      }),
      execute: withLocalIdErrorHandling(
        async ({ trackIds, position }: { position: "append" | "next"; trackIds: string[] }) => {
          const realTrackIds = trackIds.map((id) => resolveMaybeTrack(id, deps));
          if (position === "next") await playQueuePlayNext(realTrackIds, db);
          else await playQueueAppend(realTrackIds, db);
          return executeNowPlayingGet({
            db,
            localIds: deps.localIds,
            persistLocalIds: deps.persistLocalIds,
            resultId: `result:queue_add:${realTrackIds.join(",")}`,
          });
        },
      ),
    }),
    queue_edit: tool({
      description: "Update play queue repeat mode.",
      inputSchema: z.object({ repeat: z.enum(["off", "one", "all"]) }),
      execute: ({ repeat }) => playQueueSetRepeat(repeat, db),
    }),
    queue_clear: tool({
      description: "Empty the play queue (the playlist). Does not delete any set.",
      inputSchema: z.object({}),
      execute: withLocalIdErrorHandling(async () => {
        await playQueueSet([], {}, db);
        return executeNowPlayingGet({
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
          resultId: "result:queue_clear",
        });
      }),
    }),
    play_set: tool({
      description:
        "Start playing a #S set now: load its tracks into the play queue (replacing the current playlist) and begin from the top.",
      inputSchema: z.object({ sessionId: z.string().min(1) }),
      execute: withLocalIdErrorHandling(async ({ sessionId }) => {
        const realSessionId = resolveMaybeSet(sessionId, deps);
        await (deps.player ?? (await defaultPlayerControl(db))).playSet(realSessionId);
        await persistLocalIds(deps);
        return {
          status: "ok",
          commandId: "muzero.player.play_set",
          summary: "Playing the set.",
          diff: { sessionId: encodeMaybeSet(realSessionId, deps) },
          warnings: [],
        } satisfies AgentWriteResult;
      }),
    }),
    play_track: tool({
      description: "Switch the currently playing song to a specific #T track and play it now.",
      inputSchema: z.object({ trackId: z.string().min(1) }),
      execute: withLocalIdErrorHandling(async ({ trackId }) => {
        const realTrackId = resolveMaybeTrack(trackId, deps);
        await (deps.player ?? (await defaultPlayerControl(db))).playTrack(realTrackId);
        await persistLocalIds(deps);
        return {
          status: "ok",
          commandId: "muzero.player.play_track",
          summary: "Switched the current track.",
          diff: { trackId: encodeMaybeTrack(realTrackId, deps) },
          warnings: [],
        } satisfies AgentWriteResult;
      }),
    }),
    memory_search: tool({
      description:
        "Search the listener's track memories by keyword(s) (queries[], match any/all). Returns a resultRef #R; each hit has a #M memory ref and a #T track ref so you can act on that song.",
      inputSchema: memorySearchInputSchema,
      execute: withLocalIdErrorHandling((input, options) =>
        executeMemorySearch(input, {
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
          resultId: `result:${options.toolCallId}`,
        }),
      ),
    }),
    add_memory: tool({
      description:
        "Attach a Memory note to a #T track. Omit trackId to put it on whatever is playing right now. Returns #M/#T refs.",
      inputSchema: addMemoryInputSchema,
      execute: withLocalIdErrorHandling((input) =>
        executeAddMemory(input, {
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
        }),
      ),
    }),
    dj_say: tool({
      description:
        'Speak a SHORT, natural reply to the listener (one or two sentences total) in the DJ\'s voice — what you did or are about to do. Call this AT MOST ONCE per turn whenever you act on a spoken/voice request. Pass `say` as an array of parts so the voice can shift emotion mid-reply: give each part a `text` and an optional `emotion` (e.g. "happy", "excited", "gentle", "apologetic") — the spoken voice applies it, the on-screen text stays plain. Most replies are one part; split only when the tone genuinely changes. Do NOT narrate tool mechanics or ids; keep it conversational.',
      inputSchema: z
        .object({
          say: z
            .array(
              z.object({
                text: z.string().min(1),
                emotion: z.string().max(40).optional(),
              }),
            )
            .min(1)
            .max(5),
        })
        .refine((v) => v.say.reduce((n, p) => n + p.text.length, 0) <= DJ_SAY_MAX_CHARS, {
          message: `Total reply text must be ${DJ_SAY_MAX_CHARS} characters or fewer.`,
        }),
      execute: (input) => executeDjSay(input, { emit: deps.emitReply }),
    }),
  };

  // Online search/ingest — only when the user enabled a streaming source. Cheap,
  // so it's the curation path when music generation is off (PRD §4.2).
  if (deps.includeOnline) {
    tools.online_search_tracks = tool({
      description:
        "Search the user's enabled streaming sources (YouTube / Bilibili / NetEase) for songs. Read-only and free — no generation credits.",
      inputSchema: onlineSearchInputSchema,
      execute: (input) => executeOnlineSearchTracks(input, { db, streamDeps: deps.streamDeps }),
    });
    tools.online_add_tracks = tool({
      description:
        "Ingest songs from a prior online search into a #S local set (does not auto-play). Free and undoable.",
      inputSchema: onlineAddInputSchema,
      execute: withLocalIdErrorHandling((input) =>
        executeOnlineAddTracks(input, {
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
        }),
      ),
    });
  }

  // Music generation — paid, so only offered when the user enabled it AND a
  // cloud provider is configured (callers pass includeGenerate=canGenerateMusic).
  if (deps.includeGenerate !== false) {
    tools.dj_propose_briefs = tool({
      description:
        "Validate and summarize proposed TrackBriefs for user confirmation. This does not create tracks or spend provider credits.",
      inputSchema: proposeBriefsInputSchema,
      execute: executeProposeBriefs,
    });
    tools.dj_generate_tracks = tool({
      description:
        "Create pending generated tracks from validated TrackBriefs in a #S session. This spends provider credits and returns created #T refs.",
      inputSchema: generateTracksInputSchema,
      needsApproval: true,
      execute: withLocalIdErrorHandling((input) =>
        executeGenerateTracks(input, {
          db,
          localIds: deps.localIds,
          persistLocalIds: deps.persistLocalIds,
          providerId: deps.providerId,
        }),
      ),
    });
  }

  // Localize the LLM-facing tool descriptions to the UI language (voice-DJ PRD
  // §12 Phase 8). The inline English above stays canonical + the fallback, so a
  // missing translation keeps English (and tool-selection accuracy). Applied last
  // so it covers the conditionally-added online/generation tools too.
  if (deps.locale) {
    for (const [id, entry] of Object.entries(tools)) {
      const localized = toolDescription(id, deps.locale);
      if (localized) (entry as { description?: string }).description = localized;
    }
  }

  return tools;
}
