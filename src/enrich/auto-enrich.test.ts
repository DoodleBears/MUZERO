import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { getTrackEnrichment, setTrackEnrichment } from "@/db/repositories";
import { type AppSettings, DEFAULT_SETTINGS, type Track } from "@/db/types";
import { enrichmentRecordFromHit, runAutoEnrich, shouldAutoEnrich } from "./auto-enrich";
import type { EnrichmentHit, MetadataEnrichmentProvider } from "./provider";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-enrich-test-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

function track(over: Partial<Track> = {}): Track {
  return {
    id: "trk_1",
    sessionId: "ses_1",
    title: "稻香",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 214,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    mediaMetadata: { artists: ["周杰伦"], parser: "music-metadata", parsedAt: 0 },
    ...over,
  };
}

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, autoEnrich: true, ...over };
}

const HIT: EnrichmentHit = {
  source: "musicbrainz",
  sourceId: "art1",
  genres: ["mandopop", "中国风"],
  rawTags: ["mandopop", "zhongguo feng"],
  match: { confidence: 0.45, via: "artist" },
};

function provider(result: EnrichmentHit | null | Error): MetadataEnrichmentProvider {
  return {
    id: "musicbrainz",
    label: "MusicBrainz",
    fetch: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe("shouldAutoEnrich", () => {
  it("is true for an eligible uploaded track with title + artist", () => {
    expect(shouldAutoEnrich(track(), settings(), undefined)).toBe(true);
  });

  it("is false when the toggle is off", () => {
    expect(shouldAutoEnrich(track(), settings({ autoEnrich: false }), undefined)).toBe(false);
  });

  it("is false for generated tracks (they carry brief genre)", () => {
    expect(shouldAutoEnrich(track({ origin: "generated" }), settings(), undefined)).toBe(false);
  });

  it("is false when an enrichment already exists (incl. the negative cache)", () => {
    const existing = {
      id: "enr_1",
      trackId: "trk_1",
      source: "musicbrainz" as const,
      genres: [],
      status: "notFound" as const,
      fetchedAt: 0,
    };
    expect(shouldAutoEnrich(track(), settings(), existing)).toBe(false);
  });

  it("is false without enough to look up (no artist)", () => {
    expect(shouldAutoEnrich(track({ mediaMetadata: undefined }), settings(), undefined)).toBe(
      false,
    );
  });
});

describe("enrichmentRecordFromHit", () => {
  it("maps a hit to a found record", () => {
    const rec = enrichmentRecordFromHit(HIT);
    expect(rec.status).toBe("found");
    expect(rec.genres).toEqual(["mandopop", "中国风"]);
    expect(rec.source).toBe("musicbrainz");
  });

  it("maps a miss to a notFound negative cache", () => {
    const rec = enrichmentRecordFromHit(null, "musicbrainz");
    expect(rec.status).toBe("notFound");
    expect(rec.genres).toEqual([]);
  });
});

describe("runAutoEnrich", () => {
  it("fetches + persists genres for an eligible track", async () => {
    await runAutoEnrich({
      track: track(),
      settings: settings(),
      provider: provider(HIT),
      db,
      now: 111,
    });
    const stored = await getTrackEnrichment("trk_1", db);
    expect(stored?.status).toBe("found");
    expect(stored?.genres).toEqual(["mandopop", "中国风"]);
    expect(stored?.match?.via).toBe("artist");
    expect(stored?.fetchedAt).toBe(111);
  });

  it("writes a negative cache when the provider throws (never re-fetches)", async () => {
    await runAutoEnrich({
      track: track(),
      settings: settings(),
      provider: provider(new Error("network")),
      db,
    });
    const stored = await getTrackEnrichment("trk_1", db);
    expect(stored?.status).toBe("notFound");
  });

  it("writes a negative cache on a clean miss", async () => {
    await runAutoEnrich({ track: track(), settings: settings(), provider: provider(null), db });
    expect((await getTrackEnrichment("trk_1", db))?.status).toBe("notFound");
  });

  it("does not fetch when an enrichment already exists", async () => {
    await setTrackEnrichment(
      { trackId: "trk_1", record: { source: "musicbrainz", genres: ["pop"], status: "found" } },
      db,
    );
    const p = provider(HIT);
    await runAutoEnrich({ track: track(), settings: settings(), provider: p, db });
    expect(p.fetch).not.toHaveBeenCalled();
    expect((await getTrackEnrichment("trk_1", db))?.genres).toEqual(["pop"]);
  });

  it("does not fetch for a generated track", async () => {
    const p = provider(HIT);
    await runAutoEnrich({
      track: track({ origin: "generated" }),
      settings: settings(),
      provider: p,
      db,
    });
    expect(p.fetch).not.toHaveBeenCalled();
    expect(await getTrackEnrichment("trk_1", db)).toBeUndefined();
  });
});
