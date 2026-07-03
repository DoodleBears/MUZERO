import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { clearFailedEnrichments, getTrackEnrichment, setTrackEnrichment } from "@/db/repositories";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-enrichrepo-test-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("clearFailedEnrichments", () => {
  it("deletes only notFound rows (retry misses), keeping the found ones", async () => {
    await setTrackEnrichment(
      { trackId: "found_1", record: { source: "musicbrainz", genres: ["pop"], status: "found" } },
      db,
    );
    await setTrackEnrichment(
      { trackId: "miss_1", record: { source: "musicbrainz", genres: [], status: "notFound" } },
      db,
    );
    await setTrackEnrichment(
      { trackId: "miss_2", record: { source: "musicbrainz", genres: [], status: "notFound" } },
      db,
    );

    const cleared = await clearFailedEnrichments(db);

    expect(cleared).toBe(2);
    expect((await getTrackEnrichment("found_1", db))?.status).toBe("found");
    expect(await getTrackEnrichment("miss_1", db)).toBeUndefined();
    expect(await getTrackEnrichment("miss_2", db)).toBeUndefined();
  });
});
