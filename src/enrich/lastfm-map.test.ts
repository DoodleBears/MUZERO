import { describe, expect, it } from "vitest";
import { buildTopTagsUrl, LASTFM_MIN_TAG_COUNT, parseTopTags, toLastfmHit } from "./lastfm-map";

describe("buildTopTagsUrl", () => {
  it("builds a track.getTopTags request with the primary artist + key + autocorrect", () => {
    const url = buildTopTagsUrl({ trackName: "稻香", artistName: "周杰伦/Montagem" }, "KEY123");
    expect(url).toContain("method=track.gettoptags");
    expect(url).toContain("api_key=KEY123");
    expect(url).toContain("autocorrect=1");
    // Primary artist only (features dropped) + URL-encoded CJK.
    expect(url).toContain(`artist=${encodeURIComponent("周杰伦")}`);
    expect(url).not.toContain("Montagem");
    expect(url).toContain(`track=${encodeURIComponent("稻香")}`);
  });
});

describe("parseTopTags", () => {
  it("keeps tags at/above the count floor, dropping low-signal noise", () => {
    const { rawTags } = parseTopTags({
      toptags: {
        tag: [
          { name: "pop", count: 100 },
          { name: "mandopop", count: 40 },
          { name: "seen live", count: LASTFM_MIN_TAG_COUNT - 1 },
        ],
      },
    });
    expect(rawTags).toEqual(["pop", "mandopop"]);
  });

  it("tolerates a single tag returned as an object (not an array)", () => {
    expect(parseTopTags({ toptags: { tag: { name: "rock", count: 90 } } }).rawTags).toEqual([
      "rock",
    ]);
  });

  it("surfaces a Last.fm API error code", () => {
    expect(parseTopTags({ error: 6, message: "Track not found" })).toEqual({
      error: 6,
      rawTags: [],
    });
  });

  it("returns no tags for an empty/garbage body", () => {
    expect(parseTopTags(null).rawTags).toEqual([]);
    expect(parseTopTags({ toptags: {} }).rawTags).toEqual([]);
  });
});

describe("toLastfmHit", () => {
  it("normalizes tags into a lastfm hit", () => {
    const hit = toLastfmHit(["Hip-Hop", "rap", "2010s"]);
    expect(hit?.source).toBe("lastfm");
    expect(hit?.genres).toEqual(["hip hop"]); // rap→hip hop de-duped, 2010s dropped
    expect(hit?.rawTags).toEqual(["Hip-Hop", "rap", "2010s"]);
    expect(hit?.match?.via).toBe("search");
  });

  it("returns null when nothing survives normalization", () => {
    expect(toLastfmHit(["seen live", "favorites"])).toBeNull();
  });
});
