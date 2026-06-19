import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { clearTrackLyrics, getTrackLyrics, setTrackLyrics } from "@/db/repositories";
import { type AppSettings, DEFAULT_SETTINGS, type Track } from "@/db/types";
import {
  type LyricsFetchEvent,
  lyricsRecordFromHit,
  runAutoFetchLyrics,
  shouldAutoFetchLyrics,
} from "./auto-fetch";
import type { LyricsHit, LyricsProvider } from "./provider";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-lyrics-test-${Math.random().toString(36).slice(2)}`;
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
    title: "Blue Highway",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 214,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    mediaMetadata: {
      artists: ["Deidian"],
      album: "Moonstone Beach",
      parser: "music-metadata",
      parsedAt: 0,
    },
    ...over,
  };
}

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, autoFetchLyrics: true, ...over };
}

const HIT: LyricsHit = {
  source: "lrclib",
  sourceId: "42",
  synced: "[00:01.00]x",
  plain: "x",
  instrumental: false,
  matched: { trackName: "Blue Highway", artistName: "Deidian", durationSec: 214 },
};

function provider(result: LyricsHit | null | Error): LyricsProvider {
  return {
    id: "lrclib",
    label: "LRCLIB",
    fetch: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe("track-lyrics repository", () => {
  it("stores and reads a lyrics record with a lyr_ id", async () => {
    await setTrackLyrics(
      {
        trackId: "trk_1",
        record: { source: "manual", instrumental: false, status: "found", plain: "hi" },
      },
      db,
    );
    const row = await getTrackLyrics("trk_1", db);
    expect(row?.id.startsWith("lyr")).toBe(true);
    expect(row).toMatchObject({ trackId: "trk_1", source: "manual", status: "found", plain: "hi" });
  });

  it("updates in place, keeping the same row id", async () => {
    await setTrackLyrics({ trackId: "trk_1", record: lyricsRecordFromHit(HIT) }, db);
    const first = await getTrackLyrics("trk_1", db);
    await setTrackLyrics(
      {
        trackId: "trk_1",
        record: { source: "manual", instrumental: false, status: "found", plain: "edited" },
      },
      db,
    );
    const second = await getTrackLyrics("trk_1", db);
    expect(second?.id).toBe(first?.id);
    expect(second?.plain).toBe("edited");
  });

  it("clears a lyrics row", async () => {
    await setTrackLyrics({ trackId: "trk_1", record: lyricsRecordFromHit(HIT) }, db);
    await clearTrackLyrics("trk_1", db);
    expect(await getTrackLyrics("trk_1", db)).toBeUndefined();
  });
});

describe("lyricsRecordFromHit", () => {
  it("maps a normal hit to a found record", () => {
    expect(lyricsRecordFromHit(HIT)).toEqual({
      source: "lrclib",
      sourceId: "42",
      synced: "[00:01.00]x",
      plain: "x",
      instrumental: false,
      status: "found",
    });
  });

  it("maps an instrumental hit to an instrumental record", () => {
    const rec = lyricsRecordFromHit({
      ...HIT,
      instrumental: true,
      synced: undefined,
      plain: undefined,
    });
    expect(rec.status).toBe("instrumental");
    expect(rec.instrumental).toBe(true);
  });

  it("maps null to a notFound negative-cache record", () => {
    expect(lyricsRecordFromHit(null)).toEqual({
      source: "lrclib",
      instrumental: false,
      status: "notFound",
    });
  });

  it("stamps a manual source when asked", () => {
    expect(lyricsRecordFromHit(HIT, "manual").source).toBe("manual");
  });

  it("carries match info when the hit has it", () => {
    const rec = lyricsRecordFromHit({ ...HIT, match: { confidence: 0.9, via: "norm" } });
    expect(rec.match).toEqual({ confidence: 0.9, via: "norm" });
  });
});

describe("shouldAutoFetchLyrics", () => {
  it("is false when auto-fetch is disabled", () => {
    expect(shouldAutoFetchLyrics(track(), settings({ autoFetchLyrics: false }), undefined)).toBe(
      false,
    );
  });

  it("is false for generated tracks (they use brief.lyrics)", () => {
    expect(shouldAutoFetchLyrics(track({ origin: "generated" }), settings(), undefined)).toBe(
      false,
    );
  });

  it("is false when a record already exists (incl. negative cache)", () => {
    const existing = {
      id: "lyr_1",
      trackId: "trk_1",
      source: "lrclib" as const,
      instrumental: false,
      status: "notFound" as const,
      fetchedAt: 0,
    };
    expect(shouldAutoFetchLyrics(track(), settings(), existing)).toBe(false);
  });

  it("is false when there is no usable query (no artist)", () => {
    expect(shouldAutoFetchLyrics(track({ mediaMetadata: undefined }), settings(), undefined)).toBe(
      false,
    );
  });

  it("is true for a ready uploaded track with metadata and no record", () => {
    expect(shouldAutoFetchLyrics(track(), settings(), undefined)).toBe(true);
  });
});

describe("runAutoFetchLyrics", () => {
  it("fetches and stores a found record", async () => {
    const p = provider(HIT);
    await runAutoFetchLyrics({ track: track(), settings: settings(), provider: p, db, now: 1000 });
    const row = await getTrackLyrics("trk_1", db);
    expect(row).toMatchObject({ status: "found", synced: "[00:01.00]x", fetchedAt: 1000 });
    expect(row?.matched).toEqual(HIT.matched);
  });

  it("stores a negative cache when nothing is found", async () => {
    await runAutoFetchLyrics({
      track: track(),
      settings: settings(),
      provider: provider(null),
      db,
    });
    expect((await getTrackLyrics("trk_1", db))?.status).toBe("notFound");
  });

  it("does not fetch when a record already exists", async () => {
    await setTrackLyrics({ trackId: "trk_1", record: lyricsRecordFromHit(HIT) }, db);
    const p = provider(HIT);
    await runAutoFetchLyrics({ track: track(), settings: settings(), provider: p, db });
    expect(p.fetch).not.toHaveBeenCalled();
  });

  it("does not fetch generated tracks", async () => {
    const p = provider(HIT);
    await runAutoFetchLyrics({
      track: track({ origin: "generated" }),
      settings: settings(),
      provider: p,
      db,
    });
    expect(p.fetch).not.toHaveBeenCalled();
  });

  it("does not fetch when disabled", async () => {
    const p = provider(HIT);
    await runAutoFetchLyrics({
      track: track(),
      settings: settings({ autoFetchLyrics: false }),
      provider: p,
      db,
    });
    expect(p.fetch).not.toHaveBeenCalled();
  });

  it("does not write when aborted mid-flight", async () => {
    const controller = new AbortController();
    controller.abort();
    await runAutoFetchLyrics({
      track: track(),
      settings: settings(),
      provider: provider(HIT),
      signal: controller.signal,
      db,
    });
    expect(await getTrackLyrics("trk_1", db)).toBeUndefined();
  });

  it("caches a negative result on provider error (no auto-retry)", async () => {
    await expect(
      runAutoFetchLyrics({
        track: track(),
        settings: settings(),
        provider: provider(new Error("net")),
        db,
      }),
    ).resolves.toBeUndefined();
    expect((await getTrackLyrics("trk_1", db))?.status).toBe("notFound");
  });

  it("does NOT cache when aborted mid-flight (transient, retry later)", async () => {
    const controller = new AbortController();
    controller.abort();
    await runAutoFetchLyrics({
      track: track(),
      settings: settings(),
      provider: provider(new Error("net")),
      signal: controller.signal,
      db,
    });
    expect(await getTrackLyrics("trk_1", db)).toBeUndefined();
  });

  it("reports start then found with confidence", async () => {
    const events: LyricsFetchEvent[] = [];
    await runAutoFetchLyrics({
      track: track(),
      settings: settings(),
      provider: provider({ ...HIT, match: { confidence: 0.95, via: "exact" } }),
      db,
      report: (e) => events.push(e),
    });
    expect(events[0]).toEqual({ phase: "start" });
    expect(events[1]).toMatchObject({
      phase: "found",
      source: "lrclib",
      confidence: 0.95,
      instrumental: false,
    });
  });

  it("reports start then notFound when nothing matches", async () => {
    const events: LyricsFetchEvent[] = [];
    await runAutoFetchLyrics({
      track: track(),
      settings: settings(),
      provider: provider(null),
      db,
      report: (e) => events.push(e),
    });
    expect(events.map((e) => e.phase)).toEqual(["start", "notFound"]);
  });

  it("reports start then error on provider failure", async () => {
    const events: LyricsFetchEvent[] = [];
    await runAutoFetchLyrics({
      track: track(),
      settings: settings(),
      provider: provider(new Error("net")),
      db,
      report: (e) => events.push(e),
    });
    expect(events.map((e) => e.phase)).toEqual(["start", "error"]);
  });

  it("does not report at all when the fetch is skipped (record exists)", async () => {
    await setTrackLyrics({ trackId: "trk_1", record: lyricsRecordFromHit(HIT) }, db);
    const events: LyricsFetchEvent[] = [];
    await runAutoFetchLyrics({
      track: track(),
      settings: settings(),
      provider: provider(HIT),
      db,
      report: (e) => events.push(e),
    });
    expect(events).toEqual([]);
  });
});
