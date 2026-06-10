import { describe, expect, it } from "vitest";
import {
  buildGetUrl,
  buildSearchUrl,
  LRCLIB_BASE_URL,
  parseHit,
  parseSearchResults,
  pickBestHit,
} from "./lrclib-map";
import type { LyricsHit, LyricsQuery } from "./provider";

const QUERY: LyricsQuery = {
  trackName: "I Want to Live",
  artistName: "Borislav Slavov",
  albumName: "Baldur's Gate 3 (Original Game Soundtrack)",
  durationSec: 233,
};

function record(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 3396226,
    trackName: "I Want to Live",
    artistName: "Borislav Slavov",
    albumName: "Baldur's Gate 3",
    duration: 233,
    instrumental: false,
    plainLyrics: "I feel your breath",
    syncedLyrics: "[00:17.12] I feel your breath",
    ...over,
  };
}

describe("buildGetUrl", () => {
  it("uses snake_case params and rounds duration", () => {
    const url = buildGetUrl({ ...QUERY, durationSec: 233.6 });
    expect(url.startsWith(`${LRCLIB_BASE_URL}/api/get?`)).toBe(true);
    const qs = new URL(url).searchParams;
    expect(qs.get("track_name")).toBe("I Want to Live");
    expect(qs.get("artist_name")).toBe("Borislav Slavov");
    expect(qs.get("album_name")).toBe("Baldur's Gate 3 (Original Game Soundtrack)");
    expect(qs.get("duration")).toBe("234");
  });

  it("omits album and duration when absent", () => {
    const qs = new URL(buildGetUrl({ trackName: "t", artistName: "a" })).searchParams;
    expect(qs.has("album_name")).toBe(false);
    expect(qs.has("duration")).toBe(false);
  });
});

describe("buildSearchUrl", () => {
  it("includes track and artist but not duration", () => {
    const qs = new URL(buildSearchUrl(QUERY)).searchParams;
    expect(qs.get("track_name")).toBe("I Want to Live");
    expect(qs.get("artist_name")).toBe("Borislav Slavov");
    expect(qs.has("duration")).toBe(false);
  });
});

describe("parseHit", () => {
  it("maps a camelCase record to a LyricsHit", () => {
    const hit = parseHit(record());
    expect(hit).toEqual({
      source: "lrclib",
      sourceId: "3396226",
      synced: "[00:17.12] I feel your breath",
      plain: "I feel your breath",
      instrumental: false,
      matched: { trackName: "I Want to Live", artistName: "Borislav Slavov", durationSec: 233 },
    });
  });

  it("returns an instrumental hit with no lyrics text", () => {
    const hit = parseHit(record({ instrumental: true, plainLyrics: null, syncedLyrics: null }));
    expect(hit?.instrumental).toBe(true);
    expect(hit?.synced).toBeUndefined();
    expect(hit?.plain).toBeUndefined();
  });

  it("returns null for a record with no usable lyrics and not instrumental", () => {
    expect(
      parseHit(record({ instrumental: false, plainLyrics: null, syncedLyrics: null })),
    ).toBeNull();
  });

  it("returns null for non-objects", () => {
    expect(parseHit(null)).toBeNull();
    expect(parseHit("nope")).toBeNull();
    expect(parseHit(undefined)).toBeNull();
  });
});

describe("parseSearchResults", () => {
  it("maps an array and drops unusable entries", () => {
    const hits = parseSearchResults([
      record({ id: 1 }),
      record({ id: 2, instrumental: false, plainLyrics: null, syncedLyrics: null }),
      "garbage",
    ]);
    expect(hits.map((h) => h.sourceId)).toEqual(["1"]);
  });

  it("returns [] for non-arrays", () => {
    expect(parseSearchResults({})).toEqual([]);
    expect(parseSearchResults(null)).toEqual([]);
  });
});

describe("pickBestHit", () => {
  const synced = (id: number, dur: number): LyricsHit => ({
    source: "lrclib",
    sourceId: String(id),
    synced: "[00:01.00]x",
    instrumental: false,
    matched: { trackName: "t", artistName: "a", durationSec: dur },
  });
  const plainOnly = (id: number, dur: number): LyricsHit => ({
    source: "lrclib",
    sourceId: String(id),
    plain: "x",
    instrumental: false,
    matched: { trackName: "t", artistName: "a", durationSec: dur },
  });
  const instrumental = (id: number, dur: number): LyricsHit => ({
    source: "lrclib",
    sourceId: String(id),
    instrumental: true,
    matched: { trackName: "t", artistName: "a", durationSec: dur },
  });

  it("prefers a synced hit over a plain-only hit", () => {
    const best = pickBestHit([plainOnly(1, 233), synced(2, 233)], QUERY);
    expect(best?.sourceId).toBe("2");
  });

  it("breaks ties by closest duration", () => {
    const best = pickBestHit([synced(1, 200), synced(2, 232), synced(3, 260)], QUERY);
    expect(best?.sourceId).toBe("2");
  });

  it("deprioritizes instrumental matches", () => {
    const best = pickBestHit([instrumental(1, 233), plainOnly(2, 233)], QUERY);
    expect(best?.sourceId).toBe("2");
  });

  it("returns null for an empty list", () => {
    expect(pickBestHit([], QUERY)).toBeNull();
  });
});
