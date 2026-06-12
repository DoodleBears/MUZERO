import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession, playQueueSet } from "@/db/repositories";
import type { Track } from "@/db/types";
import { createDjChatLocalIdRegistry, resolveSetRef, resolveTrackRef } from "./dj-chat-local-ids";
import {
  createDjChatTools,
  executeAddMemory,
  executeCreateSet,
  executeLibrarySearch,
  executeSetAddTracks,
} from "./dj-chat-tools";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-chat-tools-local-ids-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("DJ chat tools local IDs", () => {
  it("encodes library_search results with stable entity refs and distinct result refs", async () => {
    const { rain } = await seedLibrary();
    const localIds = createDjChatLocalIdRegistry();

    const first = await executeLibrarySearch(
      { queries: ["rain"], types: ["track", "set", "lyrics"] },
      { db, localIds, resultId: "result:search:rain" },
    );
    const second = await executeLibrarySearch(
      { queries: ["rain"], types: ["track"] },
      { db, localIds, resultId: "result:search:rain-again" },
    );

    const firstTrackId = first.tracks?.items[0]?.id as string;
    expect(first.resultRef).toBe("#R1");
    expect(second.resultRef).toBe("#R2");
    expect(first.tracks?.items[0]).toMatchObject({ id: "#T1", ordinal: 1 });
    expect(second.tracks?.items[0]?.id).toBe(firstTrackId);
    expect(first.sets?.items[0]).toMatchObject({ id: "#S1", ordinal: 1 });
    expect(first.lyrics?.items[0]).toMatchObject({ trackId: "#T1", ordinal: 1 });
    expect(resolveTrackRef(firstTrackId, localIds)).toBe(rain.id);
    expect(JSON.stringify(first)).not.toMatch(/trk_|ses_/);
  });

  it("uses local refs from read tools to create sets, add tracks, and play tracks", async () => {
    const { focus, rain } = await seedLibrary();
    const localIds = createDjChatLocalIdRegistry();
    const search = await executeLibrarySearch(
      { queries: ["rain"], types: ["track"] },
      { db, localIds, resultId: "result:search:create" },
    );
    const rainRef = search.tracks?.items[0]?.id as string;
    const focusRef = localIds.toLocal(focus.id, "T");

    const created = await executeCreateSet(
      { name: "Agent Picks", autoExtend: false, trackIds: [rainRef] },
      { db, localIds },
    );
    const setRef = created.id;
    expect(setRef).toMatch(/^#S\d+$/);
    expect(resolveSetRef(setRef, localIds)).toMatch(/^ses_/);
    expect((await db.sessions.get(resolveSetRef(setRef, localIds)))?.trackIds).toEqual([rain.id]);

    const add = await executeSetAddTracks(
      { sessionId: setRef, trackIds: [focusRef] },
      { db, localIds },
    );
    expect(add.status).toBe("ok");
    expect(add.diff.sessionId).toBe(setRef);
    expect((await db.sessions.get(resolveSetRef(setRef, localIds)))?.trackIds.sort()).toEqual(
      [rain.id, focus.id].sort(),
    );

    const calls: string[] = [];
    const tools = createDjChatTools({
      db,
      localIds,
      player: {
        playSet: async (id) => {
          calls.push(`set:${id}`);
        },
        playTrack: async (id) => {
          calls.push(`track:${id}`);
        },
      },
    });
    const opts = { toolCallId: "call_play", messages: [] } as never;
    const play = await tools.play_track.execute?.({ trackId: rainRef }, opts);

    expect(calls).toEqual([`track:${rain.id}`]);
    expect(play?.diff.trackId).toBe(rainRef);
  });

  it("returns result envelopes for set, now-playing, and memory read tools", async () => {
    const { rain, set } = await seedLibrary();
    const localIds = createDjChatLocalIdRegistry();
    const setRef = localIds.toLocal(set.id, "S");
    const trackRef = localIds.toLocal(rain.id, "T");
    await playQueueSet([rain.id], { contextSetId: set.id, currentIndex: 0 }, db);
    await executeAddMemory({ trackId: trackRef, note: "rainy commute" }, { db, localIds });

    const tools = createDjChatTools({ db, localIds });
    const setList = await tools.set_list.execute?.({}, {
      toolCallId: "call_set_list",
      messages: [],
    } as never);
    const setGet = await tools.set_get.execute?.({ sessionId: setRef }, {
      toolCallId: "call_set_get",
      messages: [],
    } as never);
    const nowPlaying = await tools.now_playing_get.execute?.({}, {
      toolCallId: "call_now_playing",
      messages: [],
    } as never);
    const memory = await tools.memory_search.execute?.({ queries: ["commute"] }, {
      toolCallId: "call_memory",
      messages: [],
    } as never);

    expect(setList?.resultRef).toBe("#R1");
    expect(setList?.items[0]).toMatchObject({ id: setRef, ordinal: 1 });
    expect(setGet?.resultRef).toBe("#R2");
    expect(setGet?.set).toMatchObject({ id: setRef });
    expect(setGet?.tracks[0]).toMatchObject({ id: trackRef, ordinal: 1 });
    expect(nowPlaying?.resultRef).toBe("#R3");
    expect(nowPlaying?.entries[0]).toMatchObject({ id: "#Q1", trackId: trackRef, ordinal: 1 });
    expect(nowPlaying?.contextSetId).toBe(setRef);
    expect(memory?.resultRef).toBe("#R4");
    expect(memory?.memories[0]).toMatchObject({ memoryId: "#M1", trackId: trackRef, ordinal: 1 });
    expect(JSON.stringify({ setList, setGet, nowPlaying, memory })).not.toMatch(
      /trk_|ses_|mem_|pqe_/,
    );
  });
});

async function seedLibrary() {
  const rain = trackRow({ id: "trk_rain", title: "Rain Mirror", tags: ["rain"] });
  const focus = trackRow({ id: "trk_focus", title: "Focus Lamp", tags: ["focus"] });
  await db.tracks.bulkPut([rain, focus]);
  const set = await createSession({ name: "Rain Set", seedPrompt: "" }, db);
  await db.sessions.update(set.id, { trackIds: [rain.id] });
  return { focus, rain, set };
}

function trackRow(input: { id: string; tags?: string[]; title: string }): Track {
  const now = Date.now();
  return {
    id: input.id,
    sessionId: "ses_seed",
    title: input.title,
    status: "ready",
    durationSec: 180,
    createdAt: now,
    updatedAt: now,
    brief: {
      title: input.title,
      caption: input.tags?.join(" ") ?? "",
      lyrics: input.tags?.includes("rain") ? "rain" : "",
      durationSec: 60,
    },
    provider: "upload",
    kind: "audio",
    origin: "uploaded",
    tags: input.tags ?? [],
    liked: false,
    playCount: 0,
  };
}
