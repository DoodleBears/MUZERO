import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import {
  addMemory,
  createPendingTrack,
  createSession,
  getAllTags,
  getPlayQueue,
  getSession,
  getSettings,
  getTracksByIds,
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
import type { DjSession, PlayQueue, Track } from "@/db/types";
import { describeBrief, type TrackBrief, trackBriefSchema } from "@/dj/dj-brief-schema";
import { newId } from "@/lib/id";
import { searchTracks } from "@/lib/track-search";
import {
  generatedTrackMemoryNote,
  musicGenProviderPresetKey,
  musicGenProviderPresetKeyFromSettings,
} from "@/musicgen/provenance";
import type { StreamSearchHit } from "@/streamsrc/provider";
import { resolveEnabledStreamSources, type StreamSourceDeps } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";
import { addHitsToSet } from "@/streamsrc/streamed-track-repo";

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
function projectTrack(track: Track, fields: readonly TrackResultField[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const f of fields) {
    if (f === "artist") row.artist = track.mediaMetadata?.artists?.[0] ?? track.streamMeta?.artist;
    else if (f === "album") row.album = track.mediaMetadata?.album ?? track.streamMeta?.album;
    else row[f] = track[f as keyof Track];
  }
  return row;
}

/** Multi-keyword search: per-term match, combined by union ("any") or intersection ("all"). */
function searchMultiTerm(
  tracks: Track[],
  terms: string[],
  match: "any" | "all",
  notes?: ReadonlyMap<string, readonly string[]>,
): Track[] {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return tracks;
  if (cleaned.length === 1) return searchTracks(tracks, cleaned[0], notes);
  const perTerm = cleaned.map((t) => new Set(searchTracks(tracks, t, notes).map((x) => x.id)));
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

const streamSourceEnum = z.enum(["netease", "bili", "youtube"]);

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

export const setAddBySearchInputSchema = z.object({
  sessionId: z.string().min(1),
  queries: z.array(z.string().min(1)).min(1).max(8),
  match: z.enum(["any", "all"]).default("any"),
  /** Safety cap on how many matches to add (no 50-item display limit applies here). */
  limit: z.number().int().min(1).max(2000).default(1000),
});

export type SetAddBySearchInput = z.input<typeof setAddBySearchInputSchema>;

export const createSetInputSchema = z.object({
  name: z.string().max(80).optional(),
  seedPrompt: z.string().default(""),
  autoExtend: z.boolean().default(false),
  /** Existing local track ids to seed the new set with, in this order (optional). */
  trackIds: z.array(z.string().min(1)).max(500).optional(),
});

export type CreateSetInput = z.input<typeof createSetInputSchema>;

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
}

export async function executeSearchTracks(
  rawInput: SearchTracksInput,
  deps: { db?: MuzeroDB } = {},
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
  const notes = await memoryNotesByTrack(
    tracks.map((track) => track.id),
    db,
  );
  const terms = [...(input.queries ?? []), ...(input.query ? [input.query] : [])];
  const matched = searchMultiTerm(tracks, terms, input.match, notes);
  const fields = input.fields?.length ? input.fields : (["id", "title"] as const);
  const page = matched.slice(input.cursor, input.cursor + input.limit);
  const nextOffset = input.cursor + page.length;
  return {
    total: matched.length, // full match count so the agent knows if it's truncated
    returned: page.length,
    nextCursor: nextOffset < matched.length ? nextOffset : null,
    tracks: page.map((track) => projectTrack(track, fields)),
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
  const session = await getSession(input.sessionId, db);
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

  return {
    status: "ok",
    commandId: "muzero.dj.generate_tracks",
    summary: `Created ${ids.length} pending track${ids.length === 1 ? "" : "s"}.`,
    diff: {
      createdTrackIds: ids,
      sessionId: session.id,
      queued: input.playNext ? "next" : "append",
    },
    warnings: [],
  };
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
  deps: { db?: MuzeroDB } = {},
): Promise<AgentWriteResult & { diff: { sessionId: string; added: number; skipped: number } }> {
  const input = setAddTracksInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const session = await getSession(input.sessionId, db);
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
  const present = await getTracksByIds(input.trackIds, db); // skips ids with no track row
  const toAdd = present.map((t) => t.id).filter((id) => !existing.has(id));
  await prependTrackIds(session.id, toAdd, db);
  return {
    status: "ok",
    commandId: "muzero.set.add_tracks",
    summary: `Added ${toAdd.length} track(s) to the set; ${input.trackIds.length - toAdd.length} skipped (unknown or already present).`,
    diff: {
      sessionId: session.id,
      added: toAdd.length,
      skipped: input.trackIds.length - toAdd.length,
    },
    warnings: [],
  };
}

/**
 * Curate by query: search the WHOLE local library (no display cap) and add every
 * match to a set in one call. The matched track ids never enter the LLM context —
 * the agent says "make a lofi set" and gets back a count — so this scales to a big
 * library without blowing the token budget. Free / undoable.
 */
export async function executeSetAddBySearch(
  rawInput: SetAddBySearchInput,
  deps: { db?: MuzeroDB } = {},
): Promise<
  AgentWriteResult & {
    diff: { sessionId: string; matched: number; added: number; skipped: number };
  }
> {
  const input = setAddBySearchInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const session = await getSession(input.sessionId, db);
  if (!session) {
    return {
      status: "error",
      commandId: "muzero.set.add_by_search",
      summary: "Target set was not found.",
      diff: { sessionId: input.sessionId, matched: 0, added: 0, skipped: 0 },
      warnings: ["missing-session"],
    };
  }
  const tracks = await listAllTracks(db);
  const notes = await memoryNotesByTrack(
    tracks.map((t) => t.id),
    db,
  );
  const matched = searchMultiTerm(tracks, input.queries, input.match, notes).slice(0, input.limit);
  const existing = new Set(session.trackIds);
  const toAdd = matched.map((t) => t.id).filter((id) => !existing.has(id));
  await prependTrackIds(session.id, toAdd, db);
  return {
    status: "ok",
    commandId: "muzero.set.add_by_search",
    summary: `Matched ${matched.length}; added ${toAdd.length} to the set (${matched.length - toAdd.length} already present).`,
    diff: {
      sessionId: session.id,
      matched: matched.length,
      added: toAdd.length,
      skipped: matched.length - toAdd.length,
    },
    warnings: [],
  };
}

/**
 * Create a set and (optionally) populate it with existing local track ids in one
 * call — so "make a playlist with these songs" is a single step instead of
 * create-then-add. Unknown ids are skipped. Returns the new set plus how many
 * tracks landed. Free / undoable.
 */
export async function executeCreateSet(
  rawInput: CreateSetInput,
  deps: { db?: MuzeroDB } = {},
): Promise<DjSession & { addedTrackCount: number }> {
  const input = createSetInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const session = await createSession(
    { name: input.name, seedPrompt: input.seedPrompt, config: { autoExtend: input.autoExtend } },
    db,
  );
  let added = 0;
  if (input.trackIds?.length) {
    const present = await getTracksByIds(input.trackIds, db); // skips unknown ids
    await prependTrackIds(
      session.id,
      present.map((t) => t.id),
      db,
    );
    added = present.length;
  }
  const final = (await getSession(session.id, db)) ?? session;
  return { ...final, addedTrackCount: added };
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
  deps: { db?: MuzeroDB } = {},
): Promise<AgentWriteResult & { diff: { sessionId: string; added: number; skipped: number } }> {
  const input = onlineAddInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const session = await getSession(input.sessionId, db);
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
  return {
    status: "ok",
    commandId: "muzero.online.add_tracks",
    summary: `Ingested ${added} track(s) into the set; ${skipped} were already present.`,
    diff: { sessionId: session.id, added, skipped },
    warnings: [],
  };
}

export function createDjChatTools(deps: DjChatToolDeps = {}): ToolSet {
  const db = deps.db ?? defaultDb;
  const tools: ToolSet = {
    library_search_tracks: tool({
      description:
        'Search local tracks by title, caption, tags, legacy note, and Memory notes. Pass multiple keywords as `queries` (match "any" gathers a genre, "all" narrows). Returns are projected to `fields` (default id+title) to keep JSON small; `total` is the full match count, `returned` is this page. Page through large results with `cursor`: pass the previous call\'s `nextCursor` back as `cursor` until it is null. To curate a whole genre into a set without listing every id, prefer set_add_by_search.',
      inputSchema: searchTracksInputSchema,
      execute: (input) => executeSearchTracks(input, { db }),
    }),
    library_list_tags: tool({
      description: "List distinct local tags with usage counts.",
      inputSchema: z.object({}),
      execute: () => getAllTags(db),
    }),
    now_playing_get: tool({
      description: "Read the current play queue and playing-from set context.",
      inputSchema: z.object({}),
      execute: () => getPlayQueue(db),
    }),
    set_list: tool({
      description: "List local sets, newest updated first.",
      inputSchema: z.object({}),
      execute: () => listSessions(db),
    }),
    set_get: tool({
      description: "Read one local set and its ordered tracks.",
      inputSchema: z.object({ sessionId: z.string().min(1) }),
      execute: async ({ sessionId }) => {
        const session = await getSession(sessionId, db);
        return { session, tracks: session ? await getTracksByIds(session.trackIds, db) : [] };
      },
    }),
    set_create: tool({
      description:
        "Create a local set, optionally seeding it with existing local track ids (in order) so 'make a playlist with these songs' is one call. A seeded DJ set can auto-extend; curated/upload sets should not.",
      inputSchema: createSetInputSchema,
      execute: (input) => executeCreateSet(input, { db }),
    }),
    set_update: tool({
      description: "Update free set metadata such as name or seed prompt.",
      inputSchema: z.object({
        sessionId: z.string().min(1),
        name: z.string().max(80).optional(),
        seedPrompt: z.string().optional(),
      }),
      execute: async ({ sessionId, name, seedPrompt }) => {
        await updateSession(sessionId, { name, seedPrompt }, db);
        return {
          status: "ok",
          commandId: "muzero.set.update",
          summary: "Updated set.",
          diff: { sessionId },
          warnings: [],
        } satisfies AgentWriteResult;
      },
    }),
    set_add_tracks: tool({
      description:
        "Add existing local track ids to a set — works on ANY set: an existing one (find its id via set_list/set_get) or a freshly created one. Idempotent; only known local tracks are added. Use for a hand-picked few ids.",
      inputSchema: setAddTracksInputSchema,
      execute: (input) => executeSetAddTracks(input, { db }),
    }),
    set_add_by_search: tool({
      description:
        "Curate in one shot: search the whole library with `queries` (match any/all) and add every match to a set — no need to list track ids. Targets ANY set: pass an existing set's id (from set_list) to grow it, or a new set's id. Returns matched/added/skipped counts.",
      inputSchema: setAddBySearchInputSchema,
      execute: (input) => executeSetAddBySearch(input, { db }),
    }),
    set_switch: tool({
      description: "Load a set's tracks into the playback queue.",
      inputSchema: z.object({
        sessionId: z.string().min(1),
        currentIndex: z.number().int().min(0).default(0),
      }),
      execute: async ({ sessionId, currentIndex }): Promise<PlayQueue | undefined> => {
        const session = await getSession(sessionId, db);
        if (!session) return undefined;
        return playQueueSet(session.trackIds, { currentIndex, contextSetId: session.id }, db);
      },
    }),
    queue_add: tool({
      description: "Add track ids to the play queue, either next or appended.",
      inputSchema: z.object({
        trackIds: z.array(z.string().min(1)).min(1).max(50),
        position: z.enum(["next", "append"]).default("append"),
      }),
      execute: ({ trackIds, position }) =>
        position === "next" ? playQueuePlayNext(trackIds, db) : playQueueAppend(trackIds, db),
    }),
    queue_edit: tool({
      description: "Update play queue repeat mode.",
      inputSchema: z.object({ repeat: z.enum(["off", "one", "all"]) }),
      execute: ({ repeat }) => playQueueSetRepeat(repeat, db),
    }),
    queue_clear: tool({
      description: "Empty the play queue (the playlist). Does not delete any set.",
      inputSchema: z.object({}),
      execute: () => playQueueSet([], {}, db),
    }),
    play_set: tool({
      description:
        "Start playing a set now: load its tracks into the play queue (replacing the current playlist) and begin from the top.",
      inputSchema: z.object({ sessionId: z.string().min(1) }),
      execute: async ({ sessionId }) => {
        await (deps.player ?? (await defaultPlayerControl(db))).playSet(sessionId);
        return {
          status: "ok",
          commandId: "muzero.player.play_set",
          summary: "Playing the set.",
          diff: { sessionId },
          warnings: [],
        } satisfies AgentWriteResult;
      },
    }),
    play_track: tool({
      description: "Switch the currently playing song to a specific local track and play it now.",
      inputSchema: z.object({ trackId: z.string().min(1) }),
      execute: async ({ trackId }) => {
        await (deps.player ?? (await defaultPlayerControl(db))).playTrack(trackId);
        return {
          status: "ok",
          commandId: "muzero.player.play_track",
          summary: "Switched the current track.",
          diff: { trackId },
          warnings: [],
        } satisfies AgentWriteResult;
      },
    }),
    add_memory: tool({
      description: "Attach a Memory note to a local track.",
      inputSchema: z.object({ trackId: z.string().min(1), note: z.string().min(1).max(2000) }),
      execute: ({ trackId, note }) => addMemory({ trackId, note }, db),
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
        "Ingest songs from a prior online search into a local set (does not auto-play). Free and undoable.",
      inputSchema: onlineAddInputSchema,
      execute: (input) => executeOnlineAddTracks(input, { db }),
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
        "Create pending generated tracks from validated TrackBriefs. This spends provider credits.",
      inputSchema: generateTracksInputSchema,
      needsApproval: true,
      execute: (input) => executeGenerateTracks(input, { db, providerId: deps.providerId }),
    });
  }

  return tools;
}
