import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { getTrackEnrichment, setTrackEnrichment } from "@/db/repositories";
import { type AppSettings, DEFAULT_SETTINGS, type Track } from "@/db/types";
import { collectEnrichmentWorkList, runEnrichmentSweep } from "./enrich-sweep";
import type { EnrichmentHit, MetadataEnrichmentProvider } from "./provider";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-sweep-test-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

function track(over: Partial<Track> & { id: string }): Track {
  return {
    sessionId: "ses_1",
    title: "Song",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 100,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    mediaMetadata: { artists: ["Artist"], parser: "music-metadata", parsedAt: 0 },
    ...over,
  };
}

const HIT: EnrichmentHit = {
  source: "musicbrainz",
  genres: ["pop"],
  match: { confidence: 0.45, via: "artist" },
};

function provider(): MetadataEnrichmentProvider {
  return { id: "musicbrainz", label: "MusicBrainz", fetch: vi.fn(async () => HIT) };
}

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, autoEnrich: true, ...over };
}

const sweepDeps = (over: Partial<Parameters<typeof runEnrichmentSweep>[0]> = {}) => ({
  db,
  getSettings: async () => settings(),
  resolveProvider: () => provider(),
  sleep: async () => {},
  interTrackDelayMs: 0,
  ...over,
});

async function seedLibrary() {
  await db.tracks.bulkAdd([
    track({ id: "trk_a", title: "A" }), // eligible, un-enriched
    track({ id: "trk_b", title: "B" }), // eligible, un-enriched
    track({ id: "trk_gen", title: "G", origin: "generated", provider: "cloud" }), // skip
    track({ id: "trk_done", title: "D" }), // already enriched
    track({ id: "trk_noartist", title: "N", mediaMetadata: undefined }), // ineligible (no artist)
  ]);
  await setTrackEnrichment(
    { trackId: "trk_done", record: { source: "lastfm", genres: ["rock"], status: "found" } },
    db,
  );
}

describe("collectEnrichmentWorkList", () => {
  it("returns only eligible tracks without an enrichment row", async () => {
    await seedLibrary();
    const work = await collectEnrichmentWorkList(db);
    expect(work.sort()).toEqual(["trk_a", "trk_b"]);
  });
});

describe("runEnrichmentSweep", () => {
  it("enriches every eligible un-enriched track, skipping the rest", async () => {
    await seedLibrary();
    const status = await runEnrichmentSweep(sweepDeps());
    expect(status).toMatchObject({ running: false, total: 2, done: 2 });
    expect((await getTrackEnrichment("trk_a", db))?.genres).toEqual(["pop"]);
    expect((await getTrackEnrichment("trk_b", db))?.status).toBe("found");
    // generated + ineligible never touched; already-enriched keeps its original value.
    expect(await getTrackEnrichment("trk_gen", db)).toBeUndefined();
    expect(await getTrackEnrichment("trk_noartist", db)).toBeUndefined();
    expect((await getTrackEnrichment("trk_done", db))?.genres).toEqual(["rock"]);
  });

  it("respects the limit (processes at most N)", async () => {
    await seedLibrary();
    const status = await runEnrichmentSweep(sweepDeps({ limit: 1 }));
    expect(status.total).toBe(1);
    expect(status.done).toBe(1);
    const enrichedCount = (await db.enrichments.toArray()).filter(
      (e) => e.source === "musicbrainz",
    ).length;
    expect(enrichedCount).toBe(1);
  });

  it("is a no-op when autoEnrich is off", async () => {
    await seedLibrary();
    const p = provider();
    const status = await runEnrichmentSweep(
      sweepDeps({
        getSettings: async () => settings({ autoEnrich: false }),
        resolveProvider: () => p,
      }),
    );
    expect(status.running).toBe(false);
    expect(p.fetch).not.toHaveBeenCalled();
    expect(await getTrackEnrichment("trk_a", db)).toBeUndefined();
  });

  it("writes a negative cache for a miss so a re-sweep skips it", async () => {
    await db.tracks.add(track({ id: "trk_miss", title: "M" }));
    const missProvider: MetadataEnrichmentProvider = {
      id: "musicbrainz",
      label: "MusicBrainz",
      fetch: vi.fn(async () => null),
    };
    await runEnrichmentSweep(sweepDeps({ resolveProvider: () => missProvider }));
    expect((await getTrackEnrichment("trk_miss", db))?.status).toBe("notFound");
    // Re-sweep: the negative cache means it's no longer in the work-list.
    expect(await collectEnrichmentWorkList(db)).not.toContain("trk_miss");
    const second = await runEnrichmentSweep(sweepDeps({ resolveProvider: () => missProvider }));
    expect(second.total).toBe(0);
  });
});
