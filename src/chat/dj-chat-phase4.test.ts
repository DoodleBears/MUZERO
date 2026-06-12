import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession, playQueueSet } from "@/db/repositories";
import type { Track } from "@/db/types";
import { buildNowPlayingContext } from "./dj-chat-context";
import { executeLibraryTree } from "./dj-chat-library-tree";
import {
  createDjChatLocalIdRegistry,
  resolveResultRef,
  resolveTrackRef,
  WrongDjChatLocalIdTypeError,
} from "./dj-chat-local-ids";
import { DJ_CHAT_SYSTEM_PROMPT } from "./dj-chat-prompt";
import {
  createChatSession,
  loadChatLocalIdRegistry,
  saveChatLocalIdRegistry,
} from "./dj-chat-sessions";
import { createDjChatTools, executeCreateSet, executeLibrarySearch } from "./dj-chat-tools";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-chat-phase4-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("DJ chat phase 4 local-ref contract", () => {
  it("teaches the model to browse trees, use entity refs, and keep result refs separate", () => {
    expect(DJ_CHAT_SYSTEM_PROMPT).toContain("library_tree");
    expect(DJ_CHAT_SYSTEM_PROMPT).toContain("#T");
    expect(DJ_CHAT_SYSTEM_PROMPT).toContain("#S");
    expect(DJ_CHAT_SYSTEM_PROMPT).toContain("#R");
    expect(DJ_CHAT_SYSTEM_PROMPT).toContain("resultRef");
    expect(DJ_CHAT_SYSTEM_PROMPT).toMatch(/Do not pass #R/i);

    const tools = createDjChatTools({ includeGenerate: true, includeOnline: true });
    expect(toolDescription(tools.library_search)).toContain("resultRef #R");
    expect(toolDescription(tools.set_get)).toContain("#S");
    expect(toolDescription(tools.queue_add)).toContain("#T");
    expect(toolDescription(tools.memory_search)).toContain("#M");
  });

  it("keeps one persisted registry across now-playing context, tree reads, and the next turn", async () => {
    const { rain, set } = await seedLibrary();
    await playQueueSet([rain.id], { contextSetId: set.id, currentIndex: 0 }, db);
    const chat = await createChatSession({ title: "Local refs" }, db);
    const firstTurnRegistry = await loadChatLocalIdRegistry(chat.id, db);
    const persist = () => saveChatLocalIdRegistry(chat.id, firstTurnRegistry.snapshot(), db);

    const nowPlaying = await buildNowPlayingContext(db, firstTurnRegistry);
    await persist();
    const tree = await executeLibraryTree(
      { scope: "set", setId: "#S1", limit: 20 },
      { db, localIds: firstTurnRegistry, persistLocalIds: persist, resultId: "result:tree:set" },
    );

    expect(nowPlaying).toContain("id: #S1");
    expect(nowPlaying).toContain("id: #T1");
    expect(tree.request.setId).toBe("#S1");
    expect(tree.nodes.find((node) => node.kind === "track")?.id).toBe("#T1");

    const secondTurnRegistry = await loadChatLocalIdRegistry(chat.id, db);
    const calls: string[] = [];
    const tools = createDjChatTools({
      db,
      localIds: secondTurnRegistry,
      player: {
        playSet: async () => undefined,
        playTrack: async (id) => {
          calls.push(id);
        },
      },
    });
    await tools.play_track.execute?.({ trackId: "#T1" }, toolOptions("call_play"));

    expect(calls).toEqual([rain.id]);
  });

  it("separates result refs from entity refs across multiple search windows", async () => {
    const { rain } = await seedLibrary();
    const localIds = createDjChatLocalIdRegistry();

    const first = await executeLibrarySearch(
      { queries: ["rain"], types: ["track"] },
      { db, localIds, resultId: "result:search:rain" },
    );
    const second = await executeLibrarySearch(
      { queries: ["Rain"], types: ["track"] },
      { db, localIds, resultId: "result:search:rain-again" },
    );

    expect(first.resultRef).toBe("#R1");
    expect(second.resultRef).toBe("#R2");
    expect(first.tracks?.items[0]?.id).toBe("#T1");
    expect(second.tracks?.items[0]?.id).toBe("#T1");
    expect(resolveTrackRef("#T1", localIds)).toBe(rain.id);
    expect(resolveResultRef("#R2", localIds).meta?.toolName).toBe("library_search");
    expect(() => resolveTrackRef("#R2", localIds)).toThrow(WrongDjChatLocalIdTypeError);
  });

  it("returns a model-readable recovery result when a result ref is used as a track ref", async () => {
    await seedLibrary();
    const localIds = createDjChatLocalIdRegistry();
    const search = await executeLibrarySearch(
      { queries: ["rain"], types: ["track"] },
      { db, localIds, resultId: "result:wrong-ref" },
    );
    const calls: string[] = [];
    const tools = createDjChatTools({
      db,
      localIds,
      player: {
        playSet: async () => undefined,
        playTrack: async (id) => {
          calls.push(id);
        },
      },
    });

    const result = await tools.play_track.execute?.(
      { trackId: search.resultRef ?? "#R1" },
      toolOptions("call_wrong_ref"),
    );

    expect(calls).toEqual([]);
    expect(result).toMatchObject({
      commandId: "muzero.local_id.resolve",
      diff: { actual: "R", expected: "T", localId: "#R1" },
      status: "error",
      warnings: ["wrong-local-id-type"],
    });
    expect(result?.summary).toContain("Use an entity id such as #T");
  });

  it("curates unassigned tracks into a new set and plays that set using only local refs", async () => {
    const { loose, rain } = await seedLibrary();
    const localIds = createDjChatLocalIdRegistry();
    const unassigned = await executeLibraryTree(
      { scope: "unassigned", limit: 20 },
      { db, localIds, resultId: "result:unassigned" },
    );
    const looseNode = unassigned.nodes.find(
      (node) => node.kind === "track" && node.title === loose.title,
    );
    const looseRef = looseNode?.kind === "track" ? looseNode.id : undefined;

    expect(looseRef).toMatch(/^#T\d+$/);
    const created = await executeCreateSet(
      { autoExtend: false, name: "Inbox Picks", trackIds: [looseRef ?? ""] },
      { db, localIds },
    );
    const createdRawId = localIds.fromLocal(created.id);
    const calls: string[] = [];
    const tools = createDjChatTools({
      db,
      localIds,
      player: {
        playSet: async (id) => {
          calls.push(id);
        },
        playTrack: async () => undefined,
      },
    });

    await tools.play_set.execute?.({ sessionId: created.id }, toolOptions("call_play_set"));

    expect((await db.sessions.get(createdRawId))?.trackIds).toEqual([loose.id]);
    expect((await db.sessions.toArray()).flatMap((session) => session.trackIds)).toContain(rain.id);
    expect(calls).toEqual([createdRawId]);
    expect(JSON.stringify(created)).not.toMatch(/trk_|ses_/);
  });

  it("grows an existing set from local refs and keeps tree output bounded by cursor pagination", async () => {
    const { loose, set } = await seedLibrary();
    await db.tracks.bulkPut(
      Array.from({ length: 12 }, (_, index) =>
        trackRow({ id: `trk_extra_${index}`, title: `Extra ${index}` }),
      ),
    );
    const localIds = createDjChatLocalIdRegistry();
    const tools = createDjChatTools({ db, localIds });
    const list = await tools.set_list.execute?.({}, toolOptions("call_set_list"));
    const setRef = list?.items[0]?.id;
    const looseRef = localIds.toLocal(loose.id, "T");

    const add = await tools.set_add_tracks.execute?.(
      { sessionId: setRef, trackIds: [looseRef] },
      toolOptions("call_add"),
    );
    const firstTreePage = await executeLibraryTree(
      { scope: "library", limit: 5 },
      { db, localIds, resultId: "result:paged-tree" },
    );

    expect(setRef).toMatch(/^#S\d+$/);
    expect(add).toMatchObject({ diff: { sessionId: setRef }, status: "ok" });
    expect((await db.sessions.get(set.id))?.trackIds).toContain(loose.id);
    expect(firstTreePage.nodes).toHaveLength(5);
    expect(firstTreePage.nextCursor).toBe("5");
    expect(JSON.stringify({ add, firstTreePage, list })).not.toMatch(/trk_|ses_/);
  });

  it("covers seeded fake-library variants for tree QA", async () => {
    const generated = trackRow({
      id: "trk_generated",
      origin: "generated",
      title: "Generated Pulse",
    });
    const video = trackRow({
      id: "trk_video",
      kind: "video",
      origin: "uploaded",
      title: "Video Memory",
    });
    const streamed = trackRow({
      id: "trk_streamed",
      origin: "streamed",
      provider: "youtube",
      title: "Streamed Window",
    });
    await db.tracks.bulkPut([generated, video, streamed]);
    const first = await createSession({ name: "Mixed Set", seedPrompt: "" }, db);
    const second = await createSession({ name: "Overlap Set", seedPrompt: "" }, db);
    await db.sessions.update(first.id, { trackIds: [generated.id, video.id] });
    await db.sessions.update(second.id, { trackIds: [generated.id] });
    const localIds = createDjChatLocalIdRegistry();

    const tree = await executeLibraryTree(
      { fields: ["id", "title", "kind", "origin"], limit: 50, scope: "library" },
      { db, localIds, resultId: "result:tree:qa" },
    );

    const generatedRefs = tree.nodes.flatMap((node) =>
      node.kind === "track" && node.title === generated.title ? [node.id] : [],
    );
    expect(tree.nodes.filter((node) => node.kind === "set")).toHaveLength(2);
    expect(new Set(generatedRefs)).toHaveLength(1);
    expect(tree.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "group", trackCount: 1 }),
        expect.objectContaining({ kind: "track", mediaKind: "video", origin: "uploaded" }),
        expect.objectContaining({ kind: "track", origin: "generated" }),
        expect.objectContaining({ kind: "track", origin: "streamed" }),
      ]),
    );
    expect(JSON.stringify(tree)).not.toMatch(/trk_|ses_/);
  });
});

function toolOptions(toolCallId: string) {
  return { messages: [], toolCallId } as never;
}

function toolDescription(tool: unknown): string {
  return (tool as { description?: string }).description ?? "";
}

async function seedLibrary() {
  const rain = trackRow({ id: "trk_rain", title: "Rain Mirror", tags: ["rain"] });
  const loose = trackRow({ id: "trk_loose", title: "Loose Tape", tags: ["unassigned"] });
  await db.tracks.bulkPut([rain, loose]);
  const set = await createSession({ name: "Rain Set", seedPrompt: "" }, db);
  await db.sessions.update(set.id, { trackIds: [rain.id] });
  return { loose, rain, set };
}

function trackRow(input: {
  id: string;
  kind?: Track["kind"];
  origin?: Track["origin"];
  provider?: string;
  tags?: string[];
  title: string;
}): Track {
  const now = Date.now();
  return {
    brief: {
      caption: input.tags?.join(" ") ?? "",
      durationSec: 60,
      lyrics: input.tags?.includes("rain") ? "rain rain" : "",
      title: input.title,
    },
    createdAt: now,
    durationSec: 180,
    id: input.id,
    kind: input.kind ?? "audio",
    liked: false,
    origin: input.origin ?? "uploaded",
    playCount: 0,
    provider: input.provider ?? (input.origin === "generated" ? "mock" : "upload"),
    sessionId: "ses_seed",
    status: "ready",
    tags: input.tags ?? [],
    title: input.title,
    updatedAt: now,
  };
}
