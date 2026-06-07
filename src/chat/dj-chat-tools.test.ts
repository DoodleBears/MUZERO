import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession, getPlayQueue, getSession } from "@/db/repositories";
import { trackBriefSchema } from "@/dj/dj-brief-schema";
import {
  createDjChatTools,
  executeGenerateTracks,
  executeSearchTracks,
  generateTracksInputSchema,
} from "./dj-chat-tools";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-chat-tools-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("DJ chat tools", () => {
  it("marks only dj_generate_tracks as approval-gated", () => {
    const tools = createDjChatTools({ db });
    expect(tools.dj_generate_tracks.needsApproval).toBe(true);
    expect(tools.library_search_tracks.needsApproval).toBeUndefined();
    expect(tools.set_create.needsApproval).toBeUndefined();
  });

  it("rejects invalid TrackBrief input before any DB write", async () => {
    const session = await createSession({ seedPrompt: "lofi" }, db);
    const parsed = generateTracksInputSchema.safeParse({
      sessionId: session.id,
      briefs: [{ title: "", caption: "", durationSec: 1 }],
    });

    expect(parsed.success).toBe(false);
    expect(await db.tracks.count()).toBe(0);
    expect((await getSession(session.id, db))?.trackIds).toEqual([]);
  });

  it("generates pending tracks into the target set and play-next queue", async () => {
    const session = await createSession({ seedPrompt: "lofi" }, db);
    const brief = trackBriefSchema.parse({
      title: "Rain Mirror",
      caption: "lofi piano with brushed drums",
      lyrics: "",
      durationSec: 60,
    });

    const result = await executeGenerateTracks(
      {
        sessionId: session.id,
        briefs: [brief],
        playNext: true,
      },
      { db, providerId: "cloud" },
    );

    expect(result.status).toBe("ok");
    expect(result.diff.createdTrackIds).toHaveLength(1);
    const track = await db.tracks.get(result.diff.createdTrackIds[0]);
    expect(track).toMatchObject({
      title: "Rain Mirror",
      provider: "cloud",
      status: "pending",
      sessionId: session.id,
    });
    expect((await getSession(session.id, db))?.trackIds).toEqual(result.diff.createdTrackIds);
    expect((await getPlayQueue(db)).entries.map((entry) => entry.trackId)).toEqual(
      result.diff.createdTrackIds,
    );
  });

  it("searches tracks with memory-aware matching", async () => {
    const session = await createSession({ seedPrompt: "" }, db);
    const created = await executeGenerateTracks(
      {
        sessionId: session.id,
        briefs: [
          trackBriefSchema.parse({
            title: "Metro Bloom",
            caption: "bright city pop",
            lyrics: "",
            durationSec: 60,
          }),
        ],
      },
      { db, providerId: "mock" },
    );
    await db.memories.add({
      id: "mem_1",
      trackId: created.diff.createdTrackIds[0],
      note: "Shibuya morning walk",
      createdAt: 1,
    });

    const result = await executeSearchTracks({ query: "shibuya", limit: 10 }, { db });
    expect(result.tracks.map((track) => track.title)).toEqual(["Metro Bloom"]);
  });
});
