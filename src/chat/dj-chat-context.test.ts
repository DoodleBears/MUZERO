import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession, playQueueSet } from "@/db/repositories";
import { trackBriefSchema } from "@/dj/dj-brief-schema";
import { buildNowPlayingContext } from "./dj-chat-context";
import { executeGenerateTracks } from "./dj-chat-tools";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-chat-context-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

const brief = (title: string) =>
  trackBriefSchema.parse({ title, caption: "c", lyrics: "", durationSec: 60 });

describe("buildNowPlayingContext", () => {
  it("reports the empty queue", async () => {
    expect(await buildNowPlayingContext(db)).toContain("nothing");
  });

  it("names the active set + current track with their ids and queue position", async () => {
    const set = await createSession({ name: "Late Night Lofi", seedPrompt: "lofi" }, db);
    const gen = await executeGenerateTracks(
      { sessionId: set.id, briefs: [brief("Rain Mirror"), brief("Metro Bloom"), brief("Dusk")] },
      { db, providerId: "mock" },
    );
    const ids = gen.diff.createdTrackIds;
    await playQueueSet(ids, { currentIndex: 1, contextSetId: set.id }, db);

    const context = await buildNowPlayingContext(db);
    expect(context).toContain("Late Night Lofi");
    expect(context).toContain(set.id);
    expect(context).toContain("Metro Bloom"); // the track at currentIndex 1
    expect(context).toContain(ids[1]);
    expect(context).toContain("position 2 of 3");
  });

  it("still reports the track when the queue has no playing-from set", async () => {
    const src = await createSession({ name: "src", seedPrompt: "x" }, db);
    const gen = await executeGenerateTracks(
      { sessionId: src.id, briefs: [brief("Solo")] },
      { db, providerId: "mock" },
    );
    await playQueueSet(gen.diff.createdTrackIds, {}, db); // no contextSetId

    const context = await buildNowPlayingContext(db);
    expect(context).toContain("Solo");
    expect(context).not.toContain("Playing-from set");
  });
});
