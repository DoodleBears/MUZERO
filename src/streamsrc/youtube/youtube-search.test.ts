import { describe, expect, it } from "vitest";
import { YT_CLIENTS } from "./youtube-innertube";
import { buildSearchRequestBody, parseDurationText, parseSearchResults } from "./youtube-search";

describe("buildSearchRequestBody", () => {
  it("carries the context + query and drops player-only flags", () => {
    const body = buildSearchRequestBody("rick astley", YT_CLIENTS.webRemix, { hl: "ja" });
    expect(body).toMatchObject({
      query: "rick astley",
      context: { client: { clientName: "WEB_REMIX", hl: "ja" } },
    });
    expect(body).not.toHaveProperty("videoId");
    expect(body).not.toHaveProperty("contentCheckOk");
  });
});

describe("parseDurationText", () => {
  it("parses mm:ss and hh:mm:ss", () => {
    expect(parseDurationText("3:45")).toBe(225);
    expect(parseDurationText("1:02:03")).toBe(3723);
    expect(parseDurationText(undefined)).toBeUndefined();
    expect(parseDurationText("LIVE")).toBeUndefined();
  });
});

describe("parseSearchResults", () => {
  // A response with videoRenderers buried at varying depths (drift-robust extraction).
  const response = {
    contents: {
      sectionListRenderer: {
        contents: [
          {
            itemSectionRenderer: {
              contents: [
                {
                  videoRenderer: {
                    videoId: "dQw4w9WgXcQ",
                    title: { runs: [{ text: "Never Gonna Give You Up" }] },
                    lengthText: { simpleText: "3:33" },
                    ownerText: { runs: [{ text: "Rick Astley" }] },
                    thumbnail: { thumbnails: [{ url: "t/sm" }, { url: "t/lg" }] },
                  },
                },
                { adRenderer: { ignored: true } },
                {
                  videoRenderer: {
                    videoId: "abc123",
                    title: { simpleText: "Another Song" },
                    lengthText: { simpleText: "4:10" },
                    longBylineText: { runs: [{ text: "Some Artist" }] },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  };

  it("collects every videoRenderer into hits, in order", () => {
    const hits = parseSearchResults(response);
    expect(hits).toEqual([
      {
        source: "youtube",
        externalId: "dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
        artist: "Rick Astley",
        durationSec: 213,
        coverUrl: "t/lg",
      },
      {
        source: "youtube",
        externalId: "abc123",
        title: "Another Song",
        artist: "Some Artist",
        durationSec: 250,
        coverUrl: undefined,
      },
    ]);
  });

  it("dedupes repeated videoIds and respects the limit", () => {
    const dup = {
      a: { videoRenderer: { videoId: "x", title: { simpleText: "X" } } },
      b: { videoRenderer: { videoId: "x" } },
    };
    expect(parseSearchResults(dup)).toHaveLength(1);
    expect(parseSearchResults(response, 1)).toHaveLength(1);
  });

  it("returns [] for an empty / shapeless response", () => {
    expect(parseSearchResults({})).toEqual([]);
    expect(parseSearchResults(null)).toEqual([]);
  });
});
