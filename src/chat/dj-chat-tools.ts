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
import { trackBriefSchema } from "@/dj/dj-brief-schema";
import { searchTracks } from "@/lib/track-search";

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

export interface DjChatToolDeps {
  db?: MuzeroDB;
  providerId?: string;
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
  const created: Track[] = [];
  for (const brief of input.briefs) {
    created.push(await createPendingTrack({ sessionId: session.id, brief, provider }, db));
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

export function createDjChatTools(deps: DjChatToolDeps = {}): ToolSet {
  const db = deps.db ?? defaultDb;
  return {
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
    dj_generate_tracks: tool({
      description:
        "Create pending generated tracks from validated TrackBriefs. This spends provider credits.",
      inputSchema: generateTracksInputSchema,
      needsApproval: true,
      execute: (input) => executeGenerateTracks(input, { db, providerId: deps.providerId }),
    }),
  };
}
