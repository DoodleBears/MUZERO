import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession } from "@/db/repositories";
import type { Track } from "@/db/types";
import { executeLibraryTree } from "./dj-chat-library-tree";
import { createDjChatLocalIdRegistry } from "./dj-chat-local-ids";

let db: MuzeroDB;

afterEach(async () => {
  if (db) {
    await db.delete();
    db.close();
  }
});

describe("executeLibraryTree", () => {
  it("returns sets, their tracks, and an unassigned group without raw ids", async () => {
    db = new MuzeroDB("dj-chat-library-tree-test");
    const tracks = [
      trackRow({ id: "trk_shared", title: "Shared Rain", tags: ["rain"] }),
      trackRow({ id: "trk_focus", title: "Focus Lamp", tags: ["focus"] }),
      trackRow({ id: "trk_loose", title: "Loose Tape", tags: ["unassigned"] }),
    ];
    await db.tracks.bulkPut(tracks);
    const rain = await createSession({ name: "Rain", seedPrompt: "" }, db);
    const focus = await createSession({ name: "Focus", seedPrompt: "" }, db);
    await db.sessions.update(rain.id, { trackIds: ["trk_shared", "trk_focus"] });
    await db.sessions.update(focus.id, { trackIds: ["trk_shared"] });
    const localIds = createDjChatLocalIdRegistry();

    const result = await executeLibraryTree(
      { scope: "library", includeTracks: true, limit: 20 },
      { db, localIds, resultId: "result:tree:1" },
    );

    expect(result.resultRef).toBe("#R1");
    expect(result.nodes.filter((node) => node.kind === "set")).toHaveLength(2);
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group: "unassigned", kind: "group", trackCount: 1 }),
        expect.objectContaining({ kind: "track", title: "Loose Tape" }),
      ]),
    );
    const sharedRefs = result.nodes.flatMap((node) =>
      node.kind === "track" && node.title === "Shared Rain" ? [node.id] : [],
    );
    expect(new Set(sharedRefs).size).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/trk_|ses_/);
  });

  it("decodes set refs, preserves set rank order, and pages flattened nodes", async () => {
    db = new MuzeroDB("dj-chat-library-tree-set-test");
    await db.tracks.bulkPut([
      trackRow({ id: "trk_a", title: "A" }),
      trackRow({ id: "trk_b", title: "B" }),
      trackRow({ id: "trk_c", title: "C" }),
    ]);
    const set = await createSession({ name: "Ranked", seedPrompt: "" }, db);
    await db.sessions.update(set.id, {
      trackIds: ["trk_a", "trk_b", "trk_c"],
      trackRanks: { trk_a: 20, trk_b: 10, trk_c: 30 },
    });
    const localIds = createDjChatLocalIdRegistry();
    const setRef = localIds.toLocal(set.id, "S");

    const first = await executeLibraryTree(
      { scope: "set", setId: setRef, limit: 3 },
      { db, localIds, resultId: "result:set:1" },
    );
    const second = await executeLibraryTree(
      { scope: "set", setId: setRef, limit: 3, cursor: first.nextCursor ?? undefined },
      { db, localIds, resultId: "result:set:2" },
    );

    expect(first.request.setId).toBe("#S1");
    expect(first.nodes.map((node) => node.kind === "track" && node.title).filter(Boolean)).toEqual([
      "B",
      "A",
    ]);
    expect(first.nextCursor).toBe("3");
    expect(second.nodes.map((node) => node.kind === "track" && node.title).filter(Boolean)).toEqual(
      ["C"],
    );
    expect(second.nextCursor).toBeNull();
  });

  it("gives each result page a resultRef while keeping repeated entity refs stable", async () => {
    db = new MuzeroDB("dj-chat-library-tree-result-ref-test");
    await db.tracks.put(trackRow({ id: "trk_one", title: "One" }));
    const set = await createSession({ name: "One Set", seedPrompt: "" }, db);
    await db.sessions.update(set.id, { trackIds: ["trk_one"] });
    const localIds = createDjChatLocalIdRegistry();

    const first = await executeLibraryTree(
      { scope: "library", limit: 10 },
      { db, localIds, resultId: "result:tree:first" },
    );
    const second = await executeLibraryTree(
      { scope: "library", limit: 10 },
      { db, localIds, resultId: "result:tree:second" },
    );

    const firstTrack = first.nodes.find((node) => node.kind === "track");
    const secondTrack = second.nodes.find((node) => node.kind === "track");
    expect(first.resultRef).toBe("#R1");
    expect(second.resultRef).toBe("#R2");
    expect(first.nodes[0]?.ordinal).toBe(1);
    expect(second.nodes[0]?.ordinal).toBe(1);
    expect(firstTrack?.id).toBe(secondTrack?.id);
  });
});

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
    brief: undefined,
    provider: "upload",
    kind: "audio",
    origin: "uploaded",
    tags: input.tags ?? [],
    liked: false,
    playCount: 0,
  };
}
