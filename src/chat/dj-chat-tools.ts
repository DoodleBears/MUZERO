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
import type { PlayQueue, Track } from "@/db/types";
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

export const searchTracksInputSchema = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(50).default(12),
});

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

export interface DjChatToolDeps {
  db?: MuzeroDB;
  providerId?: string;
  /** Offer the paid music-generation tools. Default true (callers gate on `canGenerateMusic`). */
  includeGenerate?: boolean;
  /** Offer the online search/ingest tools. Default false (callers gate on `hasEnabledStreamSources`). */
  includeOnline?: boolean;
  /** Injected stream deps for the online tools (tests stub the providers). */
  streamDeps?: StreamSourceDeps;
}

export async function executeSearchTracks(
  input: z.infer<typeof searchTracksInputSchema>,
  deps: { db?: MuzeroDB } = {},
): Promise<{ tracks: Array<Pick<Track, "id" | "title" | "kind" | "origin" | "status" | "tags">> }> {
  const db = deps.db ?? defaultDb;
  const tracks = await listAllTracks(db);
  const notes = await memoryNotesByTrack(
    tracks.map((track) => track.id),
    db,
  );
  return {
    tracks: searchTracks(tracks, input.query, notes)
      .slice(0, input.limit)
      .map((track) => ({
        id: track.id,
        title: track.title,
        kind: track.kind,
        origin: track.origin,
        status: track.status,
        tags: track.tags,
      })),
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
      description: "Search local tracks by title, caption, tags, legacy note, and Memory notes.",
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
        "Create a local set. A seeded DJ set can auto-extend; curated/upload sets should not.",
      inputSchema: z.object({
        name: z.string().max(80).optional(),
        seedPrompt: z.string().default(""),
        autoExtend: z.boolean().default(false),
      }),
      execute: async ({ name, seedPrompt, autoExtend }) =>
        createSession({ name, seedPrompt, config: { autoExtend } }, db),
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
