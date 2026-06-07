import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession, getSession, getTrack, getTrackBlob } from "@/db/repositories";
import { createMockMusicGenProvider } from "@/musicgen/mock-provider";
import type { TrackBrief } from "./dj-brief-schema";
import { createDjEngine, type DjBrain } from "./dj-engine";

/** A canned brain that yields scripted briefs and records the context it saw. */
function scriptedBrain(
  scripts: TrackBrief[][],
): DjBrain & { calls: number; lastRecentTitles: string[] } {
  const state = {
    calls: 0,
    lastRecentTitles: [] as string[],
    async draftBriefs(ctx: { recent: { title: string }[] }) {
      state.lastRecentTitles = ctx.recent.map((r) => r.title);
      const batch = scripts[Math.min(state.calls, scripts.length - 1)];
      state.calls += 1;
      return batch;
    },
  };
  return state;
}

function brief(title: string, caption = "lofi"): TrackBrief {
  return { title, caption, lyrics: "[instrumental]", durationSec: 30 };
}

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-test-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("DjEngine.draft", () => {
  it("drafts briefs into pending tracks and appends them to the session queue", async () => {
    const session = await createSession({ seedPrompt: "late-night lofi" }, db);
    const brain = scriptedBrain([[brief("Neon Rain"), brief("Empty Streets")]]);
    const engine = createDjEngine({ db, brain, provider: createMockMusicGenProvider() });

    const created = await engine.draft(session.id);

    expect(created).toHaveLength(2);
    expect(created.every((t) => t.status === "pending")).toBe(true);
    const reloaded = await getSession(session.id, db);
    expect(reloaded?.trackIds).toEqual(created.map((t) => t.id));
  });

  it("drops briefs that fail schema validation", async () => {
    const session = await createSession({ seedPrompt: "x" }, db);
    const bad = { title: "", caption: "" } as unknown as TrackBrief; // invalid: empty
    const brain = scriptedBrain([[bad, brief("Good One")]]);
    const engine = createDjEngine({ db, brain, provider: createMockMusicGenProvider() });

    const created = await engine.draft(session.id);
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe("Good One");
  });

  it("forces instrumental lyrics when the session disallows vocals", async () => {
    const session = await createSession({ seedPrompt: "x", config: { allowVocals: false } }, db);
    const withVocals: TrackBrief = {
      title: "Sing",
      caption: "pop",
      lyrics: "[verse]\nla la",
      durationSec: 30,
    };
    const brain = scriptedBrain([[withVocals]]);
    const engine = createDjEngine({ db, brain, provider: createMockMusicGenProvider() });

    const [track] = await engine.draft(session.id);
    expect(track.brief?.lyrics).toBe("[instrumental]");
  });
});

describe("DjEngine.materializeNext", () => {
  it("generates audio for the first pending track and stores the blob", async () => {
    const session = await createSession({ seedPrompt: "lofi" }, db);
    const brain = scriptedBrain([[brief("Neon Rain")]]);
    const engine = createDjEngine({ db, brain, provider: createMockMusicGenProvider() });
    await engine.draft(session.id);

    const materialized = await engine.materializeNext(session.id);
    expect(materialized?.status).toBe("ready");

    const track = await getTrack(materialized!.id, db);
    expect(track?.status).toBe("ready");
    expect(track?.blobId).toBeTruthy();
    expect(track?.durationSec).toBeGreaterThan(0);

    // Note: fake-indexeddb's structured clone returns Blobs as plain objects in
    // jsdom (real browser IndexedDB preserves them), so we assert the persisted
    // metadata here and verify the actual Blob at the provider layer below.
    const media = await getTrackBlob(track!, db);
    expect(media).toBeTruthy();
    expect(media!.mime).toBe("audio/wav");
    expect(media!.bytes).toBeGreaterThan(44); // WAV header + samples
  });

  it("returns null when there is nothing left to generate", async () => {
    const session = await createSession({ seedPrompt: "lofi" }, db);
    const brain = scriptedBrain([[brief("Only")]]);
    const engine = createDjEngine({ db, brain, provider: createMockMusicGenProvider() });
    await engine.draft(session.id);
    await engine.materializeNext(session.id);
    expect(await engine.materializeNext(session.id)).toBeNull();
  });

  it("marks the track failed (not thrown) when the provider errors", async () => {
    const session = await createSession({ seedPrompt: "lofi" }, db);
    const brain = scriptedBrain([[brief("Doomed")]]);
    const failing = {
      id: "boom",
      label: "boom",
      requiresConfig: false,
      async generate(): Promise<never> {
        throw new Error("model offline");
      },
    };
    const engine = createDjEngine({ db, brain, provider: failing });
    await engine.draft(session.id);
    const result = await engine.materializeNext(session.id);
    expect(result?.status).toBe("failed");
    const track = await getTrack(result!.id, db);
    expect(track?.error).toContain("model offline");
  });
});

describe("DjEngine.refillIfNeeded (续上歌单)", () => {
  it("does not refill while the queue still has runway", async () => {
    const session = await createSession(
      { seedPrompt: "x", config: { refillThreshold: 1, batchSize: 1 } },
      db,
    );
    const brain = scriptedBrain([[brief("A"), brief("B"), brief("C")]]);
    const engine = createDjEngine({ db, brain, provider: createMockMusicGenProvider() });
    await engine.draft(session.id); // queue: A B C

    // queueLength 3, currentIndex 0 → 2 upcoming > threshold 1 → no refill
    expect(await engine.refillIfNeeded(session.id, 3, 0)).toBeNull();
  });

  it("refills and feeds recent titles back to the brain for continuity", async () => {
    const session = await createSession(
      { seedPrompt: "x", config: { refillThreshold: 1, batchSize: 1 } },
      db,
    );
    const brain = scriptedBrain([[brief("A"), brief("B")], [brief("C")]]);
    const engine = createDjEngine({ db, brain, provider: createMockMusicGenProvider() });
    await engine.draft(session.id); // queue: A B
    // Make A & B "ready" so they show up in the recent context.
    await engine.materializeNext(session.id);
    await engine.materializeNext(session.id);

    // queueLength 2, currentIndex 1 → 0 upcoming ≤ threshold 1 → refill
    const refill = await engine.refillIfNeeded(session.id, 2, 1);
    expect(refill).not.toBeNull();
    expect(refill).toHaveLength(1);
    expect(refill![0].title).toBe("C");

    const reloaded = await getSession(session.id, db);
    expect(reloaded?.trackIds).toHaveLength(3);
    expect(brain.lastRecentTitles).toEqual(["A", "B"]);
  });

  it("never refills a non-DJ (upload/curated) set", async () => {
    const session = await createSession(
      { seedPrompt: "", config: { autoExtend: false, refillThreshold: 5 } },
      db,
    );
    const brain = scriptedBrain([[brief("Nope")]]);
    const engine = createDjEngine({ db, brain, provider: createMockMusicGenProvider() });
    // Even with an empty queue (well below threshold), autoExtend off ⇒ no draft.
    expect(await engine.refillIfNeeded(session.id, 0, -1)).toBeNull();
    expect(brain.calls).toBe(0);
  });
});
