import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the browser-only encoder so the wiring is testable in jsdom: every cover
// blob "encodes" to a known marker. (The real encoder needs canvas; here we only
// assert that setting a cover persists whatever thumbhash the encoder returns.)
vi.mock("@/lib/cover-thumbhash", () => ({
  encodeCoverThumbhash: vi.fn(async () => "THUMB64"),
}));

import { MuzeroDB } from "./muzero-db";
import { createSession, setEntityCover, setSessionCover, setTrackCover } from "./repositories";

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

const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

describe("cover-set generates + persists a thumbhash on the owner row (Phase 3)", () => {
  it("setTrackCover stores coverThumbhash on the track", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    const id = await db.tracks.add({
      id: "trk_thumb",
      sessionId: session.id,
      title: "t",
      kind: "audio",
      origin: "uploaded",
      provider: "upload",
      status: "ready",
      durationSec: 1,
      createdAt: 1,
      playCount: 0,
      liked: false,
      tags: [],
    });
    await setTrackCover({ trackId: id as string, blob: png(), mime: "image/png" }, db);
    expect((await db.tracks.get("trk_thumb"))?.coverThumbhash).toBe("THUMB64");
  });

  it("setSessionCover stores coverThumbhash on the session", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    await setSessionCover({ sessionId: session.id, blob: png(), mime: "image/png" }, db);
    expect((await db.sessions.get(session.id))?.coverThumbhash).toBe("THUMB64");
  });

  it("setEntityCover stores thumbhash on the entity-cover row", async () => {
    await setEntityCover(
      { entityKey: "artist::x", kind: "artist", blob: png(), mime: "image/png" },
      db,
    );
    expect((await db.entityCovers.get("artist::x"))?.thumbhash).toBe("THUMB64");
  });
});
