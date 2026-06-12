import { z } from "zod";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { getSession, listAllMemories, listAllTracks, listSessions } from "@/db/repositories";
import type { DjSession, Track } from "@/db/types";
import { newId } from "@/lib/id";
import { orderedSetTrackIds } from "@/player/set-order";
import {
  createDjChatLocalIdRegistry,
  type DjChatLocalIdRegistry,
  encodeResultRef,
  encodeSetRef,
  encodeTrackRef,
  resolveSetRef,
} from "./dj-chat-local-ids";

export const LIBRARY_TREE_TRACK_FIELDS = [
  "id",
  "title",
  "artist",
  "album",
  "tags",
  "duration",
  "kind",
  "origin",
  "status",
  "memoryCount",
] as const;

export type LibraryTreeTrackField = (typeof LIBRARY_TREE_TRACK_FIELDS)[number];

export const libraryTreeInputSchema = z.object({
  cursor: z.string().optional(),
  fields: z
    .array(z.enum(LIBRARY_TREE_TRACK_FIELDS))
    .default(["id", "title", "artist", "tags", "duration", "kind", "origin"]),
  includeTracks: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(120),
  scope: z.enum(["library", "set", "unassigned"]).default("library"),
  setId: z.string().min(1).optional(),
});

export type LibraryTreeInput = z.input<typeof libraryTreeInputSchema>;

export interface LibraryTreeSetNode {
  autoExtend: boolean;
  depth: 1;
  id: string;
  kind: "set";
  name: string;
  ordinal: number;
  trackCount: number;
  updatedAt: number;
}

export interface LibraryTreeGroupNode {
  depth: 1;
  group: "unassigned";
  kind: "group";
  name: "Unassigned";
  ordinal: number;
  trackCount: number;
}

export interface LibraryTreeTrackNode {
  album?: string;
  artist?: string;
  depth: 2;
  durationSec?: number;
  id: string;
  kind: "track";
  mediaKind?: Track["kind"];
  memoryCount?: number;
  ordinal: number;
  origin?: Track["origin"];
  status?: Track["status"];
  tags?: string[];
  title: string;
}

export type LibraryTreeNode = LibraryTreeGroupNode | LibraryTreeSetNode | LibraryTreeTrackNode;

export interface LibraryTreeOutput {
  nextCursor: string | null;
  nodes: LibraryTreeNode[];
  notes: string[];
  request: {
    includeTracks: boolean;
    scope: "library" | "set" | "unassigned";
    setId?: string;
  };
  resultRef: string;
  returned: number;
  scope: "library" | "set" | "unassigned";
}

type DraftLibraryTreeNode =
  | Omit<LibraryTreeGroupNode, "ordinal">
  | Omit<LibraryTreeSetNode, "ordinal">
  | Omit<LibraryTreeTrackNode, "ordinal">;

export async function executeLibraryTree(
  rawInput: LibraryTreeInput,
  deps: {
    db?: MuzeroDB;
    localIds?: DjChatLocalIdRegistry;
    persistLocalIds?: () => Promise<void>;
    resultId?: string;
  } = {},
): Promise<LibraryTreeOutput> {
  const input = libraryTreeInputSchema.parse(rawInput);
  const db = deps.db ?? defaultDb;
  const localIds = deps.localIds ?? createDjChatLocalIdRegistry();
  const notes: string[] = [];
  const memoryCounts = input.fields.includes("memoryCount")
    ? await memoryCountsByTrack(db)
    : new Map<string, number>();
  const allSessions = await listSessions(db);
  const allTracks = await listAllTracks(db);
  const allTrackById = new Map(allTracks.map((track) => [track.id, track]));
  const nodes: DraftLibraryTreeNode[] = [];
  let requestSetId: string | undefined;

  if (input.scope === "library") {
    for (const session of allSessions) {
      nodes.push(projectSetNode(session, localIds));
      if (!input.includeTracks) continue;
      nodes.push(
        ...projectSessionTrackNodes(session, allTrackById, localIds, input.fields, memoryCounts),
      );
    }
    nodes.push(projectUnassignedGroup(allSessions, allTracks));
    if (input.includeTracks) {
      nodes.push(
        ...projectUnassignedTrackNodes(
          allSessions,
          allTracks,
          localIds,
          input.fields,
          memoryCounts,
        ),
      );
    }
  }

  if (input.scope === "set") {
    if (!input.setId) {
      notes.push('scope:"set" requires setId. Use set_list or library_tree first.');
    } else {
      const realSetId = resolveSetRef(input.setId, localIds);
      requestSetId = encodeSetRef(realSetId, localIds);
      const session = await getSession(realSetId, db);
      if (!session) {
        notes.push("The requested set was not found. Refresh the library tree and try again.");
      } else {
        nodes.push(projectSetNode(session, localIds));
        if (input.includeTracks) {
          nodes.push(
            ...projectSessionTrackNodes(
              session,
              allTrackById,
              localIds,
              input.fields,
              memoryCounts,
            ),
          );
        }
      }
    }
  }

  if (input.scope === "unassigned") {
    nodes.push(projectUnassignedGroup(allSessions, allTracks));
    if (input.includeTracks) {
      nodes.push(
        ...projectUnassignedTrackNodes(
          allSessions,
          allTracks,
          localIds,
          input.fields,
          memoryCounts,
        ),
      );
    }
  }

  const cursor = sanitizeCursor(input.cursor);
  const page = nodes.slice(cursor, cursor + input.limit).map(withOrdinal);
  const nextOffset = cursor + page.length;
  const resultRef = encodeResultRef(deps.resultId ?? newId("res"), localIds, {
    resultSummary: { returned: page.length, scope: input.scope },
    toolName: "library_tree",
  });

  await deps.persistLocalIds?.();

  return {
    nextCursor: nextOffset < nodes.length ? String(nextOffset) : null,
    nodes: page,
    notes,
    request: {
      includeTracks: input.includeTracks,
      scope: input.scope,
      ...(requestSetId && { setId: requestSetId }),
    },
    resultRef,
    returned: page.length,
    scope: input.scope,
  };
}

function withOrdinal(node: DraftLibraryTreeNode, index: number): LibraryTreeNode {
  return { ...node, ordinal: index + 1 } as LibraryTreeNode;
}

function projectSetNode(session: DjSession, localIds: DjChatLocalIdRegistry): DraftLibraryTreeNode {
  return {
    autoExtend: session.config.autoExtend,
    depth: 1,
    id: encodeSetRef(session.id, localIds),
    kind: "set",
    name: session.name,
    trackCount: session.trackIds.length,
    updatedAt: session.updatedAt,
  };
}

function projectSessionTrackNodes(
  session: DjSession,
  trackById: ReadonlyMap<string, Track>,
  localIds: DjChatLocalIdRegistry,
  fields: readonly LibraryTreeTrackField[],
  memoryCounts: ReadonlyMap<string, number>,
): DraftLibraryTreeNode[] {
  return orderedSetTrackIds(session.trackIds, session.trackRanks).flatMap((trackId) => {
    const track = trackById.get(trackId);
    return track
      ? [projectTrackNode(track, localIds, fields, memoryCounts, { setId: session.id })]
      : [];
  });
}

function projectUnassignedGroup(
  sessions: readonly DjSession[],
  tracks: readonly Track[],
): DraftLibraryTreeNode {
  return {
    depth: 1,
    group: "unassigned",
    kind: "group",
    name: "Unassigned",
    trackCount: unassignedTracks(sessions, tracks).length,
  };
}

function projectUnassignedTrackNodes(
  sessions: readonly DjSession[],
  tracks: readonly Track[],
  localIds: DjChatLocalIdRegistry,
  fields: readonly LibraryTreeTrackField[],
  memoryCounts: ReadonlyMap<string, number>,
): DraftLibraryTreeNode[] {
  return unassignedTracks(sessions, tracks).map((track) =>
    projectTrackNode(track, localIds, fields, memoryCounts),
  );
}

function projectTrackNode(
  track: Track,
  localIds: DjChatLocalIdRegistry,
  fields: readonly LibraryTreeTrackField[],
  memoryCounts: ReadonlyMap<string, number>,
  meta?: { setId?: string },
): DraftLibraryTreeNode {
  const wanted = new Set(fields);
  const node: DraftLibraryTreeNode = {
    depth: 2,
    id: encodeTrackRef(track.id, localIds, meta),
    kind: "track",
    title: track.title,
  };
  if (wanted.has("artist"))
    node.artist = track.mediaMetadata?.artists?.[0] ?? track.streamMeta?.artist;
  if (wanted.has("album")) node.album = track.mediaMetadata?.album ?? track.streamMeta?.album;
  if (wanted.has("tags")) node.tags = track.tags;
  if (wanted.has("duration")) node.durationSec = track.durationSec;
  if (wanted.has("kind")) node.mediaKind = track.kind;
  if (wanted.has("origin")) node.origin = track.origin;
  if (wanted.has("status")) node.status = track.status;
  if (wanted.has("memoryCount")) node.memoryCount = memoryCounts.get(track.id) ?? 0;
  return node;
}

function unassignedTracks(sessions: readonly DjSession[], tracks: readonly Track[]): Track[] {
  const assigned = new Set(sessions.flatMap((session) => session.trackIds));
  return tracks.filter((track) => !assigned.has(track.id));
}

async function memoryCountsByTrack(db: MuzeroDB): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const memory of await listAllMemories(db)) {
    counts.set(memory.trackId, (counts.get(memory.trackId) ?? 0) + 1);
  }
  return counts;
}

function sanitizeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
