import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession, playQueueSet } from "@/db/repositories";
import type { Track } from "@/db/types";
import { buildNowPlayingContext, buildSetsContext } from "./dj-chat-context";
import { createDjChatLocalIdRegistry } from "./dj-chat-local-ids";

let db: MuzeroDB;

afterEach(async () => {
  if (db) {
    await db.delete();
    db.close();
  }
});

describe("buildNowPlayingContext", () => {
  it("uses local ids for the active set and track when a registry is supplied", async () => {
    db = new MuzeroDB("dj-chat-context-local-id-test");
    const set = await createSession(
      { name: "Rain Focus", seedPrompt: "", config: { autoExtend: false } },
      db,
    );
    const track = trackRow({ id: "trk_rain", sessionId: set.id, title: "Blue Hour" });
    await db.tracks.put(track);
    await db.sessions.update(set.id, { trackIds: [track.id] });
    await playQueueSet([track.id], { contextSetId: set.id, currentIndex: 0 }, db);
    const localIds = createDjChatLocalIdRegistry();

    const context = await buildNowPlayingContext(db, localIds);

    expect(context).toContain("id: #S1");
    expect(context).toContain("id: #T1");
    expect(context).not.toContain(set.id);
    expect(context).not.toContain(track.id);
    expect(localIds.snapshot()).toEqual([
      { local: "#S1", real: set.id, type: "S" },
      { local: "#T1", real: track.id, type: "T", meta: { setId: set.id } },
    ]);
  });

  it("keeps the legacy raw-id context when no registry is supplied", async () => {
    db = new MuzeroDB("dj-chat-context-legacy-test");
    const set = await createSession(
      { name: "Legacy", seedPrompt: "", config: { autoExtend: false } },
      db,
    );
    const track = trackRow({ id: "trk_legacy", sessionId: set.id, title: "Legacy Track" });
    await db.tracks.put(track);
    await db.sessions.update(set.id, { trackIds: [track.id] });
    await playQueueSet([track.id], { contextSetId: set.id, currentIndex: 0 }, db);

    const context = await buildNowPlayingContext(db);

    expect(context).toContain(set.id);
    expect(context).toContain(track.id);
  });
});

describe("buildSetsContext", () => {
  it("returns '' when there are no sets", async () => {
    db = new MuzeroDB("dj-chat-sets-empty-test");
    expect(await buildSetsContext(db)).toBe("");
  });

  it("is a compact count hint pointing at set_list (not a full dump of names)", async () => {
    db = new MuzeroDB("dj-chat-sets-hint-test");
    await createSession({ name: "Focus Work", seedPrompt: "" }, db);
    await createSession({ name: "Chill Vibes", seedPrompt: "" }, db);

    const context = await buildSetsContext(db);

    expect(context).toContain("2 saved set");
    expect(context).toContain("set_list");
    expect(context).toContain("REUSE");
    // No per-set dump — the searchable/paginated tool handles that at scale.
    expect(context).not.toContain("Focus Work");
    expect(context).not.toContain("Chill Vibes");
  });
});

function trackRow(input: { id: string; sessionId: string; title: string }): Track {
  const now = Date.now();
  return {
    id: input.id,
    sessionId: input.sessionId,
    title: input.title,
    status: "ready",
    durationSec: 180,
    createdAt: now,
    updatedAt: now,
    brief: undefined,
    provider: "upload",
    kind: "audio",
    origin: "uploaded",
    tags: [],
    liked: false,
    playCount: 0,
  };
}
