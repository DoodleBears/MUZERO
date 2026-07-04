import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession, setTrackEnrichment } from "@/db/repositories";
import type { Track } from "@/db/types";
import { executeSetGet } from "./dj-chat-tools";

let db: MuzeroDB;

afterEach(async () => {
  if (db) {
    await db.delete();
    db.close();
  }
});

function trackRow(over: Partial<Track> & { id: string; sessionId: string }): Track {
  return {
    title: "Song",
    status: "ready",
    durationSec: 180,
    createdAt: 0,
    provider: "upload",
    kind: "audio",
    origin: "uploaded",
    tags: [],
    liked: false,
    playCount: 0,
    ...over,
  };
}

describe("executeSetGet facets", () => {
  it("returns the set's genre (file ∪ enrichment) + tag makeup with counts", async () => {
    db = new MuzeroDB("set-get-facets");
    const set = await createSession(
      { name: "Drive", seedPrompt: "", config: { autoExtend: false } },
      db,
    );
    await db.tracks.bulkPut([
      {
        ...trackRow({ id: "t1", sessionId: set.id }),
        tags: ["gym"],
        mediaMetadata: { genres: ["Pop"], artists: ["X"], parser: "music-metadata", parsedAt: 0 },
      },
      { ...trackRow({ id: "t2", sessionId: set.id }), tags: ["gym"] },
    ]);
    await db.sessions.update(set.id, { trackIds: ["t1", "t2"] });
    // t2's "pop" comes from enrichment — merged case-insensitively with t1's file "Pop".
    await setTrackEnrichment(
      { trackId: "t2", record: { source: "musicbrainz", genres: ["pop"], status: "found" } },
      db,
    );

    const result = await executeSetGet({ sessionId: set.id }, { db });

    expect(result.facets.genres).toEqual([{ name: "pop", count: 2 }]);
    expect(result.facets.tags).toEqual([{ name: "gym", count: 2 }]);
  });

  it("is empty-safe for a set with no genres/tags", async () => {
    db = new MuzeroDB("set-get-facets-empty");
    const set = await createSession(
      { name: "Bare", seedPrompt: "", config: { autoExtend: false } },
      db,
    );
    await db.tracks.put(trackRow({ id: "t1", sessionId: set.id }));
    await db.sessions.update(set.id, { trackIds: ["t1"] });

    const result = await executeSetGet({ sessionId: set.id }, { db });

    expect(result.facets).toEqual({ genres: [], tags: [] });
  });
});
