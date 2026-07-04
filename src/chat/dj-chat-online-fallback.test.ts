import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession } from "@/db/repositories";
import { trackBriefSchema } from "@/dj/dj-brief-schema";
import { createDjChatLocalIdRegistry } from "./dj-chat-local-ids";
import { executeGenerateTracks, executeLibrarySearch } from "./dj-chat-tools";

// library_search is LOCAL-only. When a track search finds nothing AND the user
// has streaming sources enabled, the result flags `onlineFallbackAvailable` so
// the DJ knows to follow up with online_search_tracks (local-first, then online).

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-online-fallback-${Math.random().toString(36).slice(2)}`;
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

async function seedTrack(title: string) {
  const src = await createSession({ seedPrompt: "src" }, db);
  await executeGenerateTracks(
    { sessionId: src.id, briefs: [brief(title)] },
    { db, providerId: "mock" },
  );
}

describe("executeLibrarySearch — online fallback signal", () => {
  it("flags onlineFallbackAvailable when a track search is empty and online is on", async () => {
    await seedTrack("Rain Mirror");
    const res = await executeLibrarySearch(
      { queries: ["nonexistent-song"], types: ["track"] },
      { db, localIds: createDjChatLocalIdRegistry(), onlineAvailable: true },
    );
    expect(res.tracks?.total).toBe(0);
    expect(res.onlineFallbackAvailable).toBe(true);
  });

  it("does NOT flag when there are local hits (no need to go online)", async () => {
    await seedTrack("Rain Mirror");
    const res = await executeLibrarySearch(
      { queries: ["Rain"], types: ["track"] },
      { db, localIds: createDjChatLocalIdRegistry(), onlineAvailable: true },
    );
    expect(res.tracks?.total).toBeGreaterThan(0);
    expect(res.onlineFallbackAvailable).toBeUndefined();
  });

  it("does NOT flag when online sources are off (nothing to fall back to)", async () => {
    const res = await executeLibrarySearch(
      { queries: ["nonexistent-song"], types: ["track"] },
      { db, localIds: createDjChatLocalIdRegistry(), onlineAvailable: false },
    );
    expect(res.tracks?.total).toBe(0);
    expect(res.onlineFallbackAvailable).toBeUndefined();
  });

  it("does NOT flag a non-track search (sets/lyrics don't have an online fallback)", async () => {
    const res = await executeLibrarySearch(
      { queries: ["nonexistent"], types: ["set"] },
      { db, localIds: createDjChatLocalIdRegistry(), onlineAvailable: true },
    );
    expect(res.onlineFallbackAvailable).toBeUndefined();
  });
});
