import { describe, expect, it } from "vitest";
import { buildLyricBody, parseNeteaseLyric, pickClosestByDuration } from "./netease-lyric-map";

describe("buildLyricBody", () => {
  it("builds the eapi lyric request body for a song id", () => {
    expect(buildLyricBody("33894312")).toEqual({
      id: "33894312",
      cp: false,
      lv: 0,
      kv: 0,
      tv: 0,
    });
  });
});

describe("parseNeteaseLyric", () => {
  it("returns synced LRC when the lyric carries timestamps", () => {
    const json = {
      code: 200,
      lrc: { lyric: "[00:12.34]故事的小黄花\n[00:15.00]从出生那年就飘着" },
    };
    expect(parseNeteaseLyric(json)).toEqual({
      synced: "[00:12.34]故事的小黄花\n[00:15.00]从出生那年就飘着",
      instrumental: false,
    });
  });

  it("returns plain text when there are no timestamps", () => {
    expect(parseNeteaseLyric({ lrc: { lyric: "just a line\nanother line" } })).toEqual({
      plain: "just a line\nanother line",
      instrumental: false,
    });
  });

  it("strips yrc metadata (songwriter/composer JSON) lines", () => {
    const lyric = [
      '{"c":[{"tx":"作词: "},{"tx":"virtua! girl","li":"http://x/y.id=1&type=artist"}]}',
      '{"c":[{"tx":"作曲: "},{"tx":"virtua! girl"}]}',
      "[00:12.34]Cause you don't need to run away tonight",
      "[00:15.00]Tonight",
    ].join("\n");
    expect(parseNeteaseLyric({ lrc: { lyric } })).toEqual({
      synced: "[00:12.34]Cause you don't need to run away tonight\n[00:15.00]Tonight",
      instrumental: false,
    });
  });

  it("strips a timestamp-prefixed yrc metadata line too", () => {
    const lyric = '[00:00.00]{"c":[{"tx":"编曲: "},{"tx":"x"}]}\n[00:10.00]real line';
    expect(parseNeteaseLyric({ lrc: { lyric } })).toEqual({
      synced: "[00:10.00]real line",
      instrumental: false,
    });
  });

  it("flags instrumental tracks (NetEase's 纯音乐 placeholder)", () => {
    expect(parseNeteaseLyric({ lrc: { lyric: "[99:00.00]纯音乐，请欣赏\n" } })).toEqual({
      instrumental: true,
    });
  });

  it("returns null when there is no lyric (uncollected / missing)", () => {
    expect(parseNeteaseLyric({ lrc: { lyric: "" } })).toBeNull();
    expect(parseNeteaseLyric({ code: 200 })).toBeNull();
    expect(parseNeteaseLyric(null)).toBeNull();
  });
});

describe("pickClosestByDuration", () => {
  const hits = [
    { externalId: "a", durationSec: 100 },
    { externalId: "b", durationSec: 200 },
    { externalId: "c", durationSec: 305 },
  ];

  it("picks the hit nearest the target duration", () => {
    expect(pickClosestByDuration(hits, 300)?.externalId).toBe("c");
    expect(pickClosestByDuration(hits, 190)?.externalId).toBe("b");
  });

  it("falls back to the first hit when no/invalid target", () => {
    expect(pickClosestByDuration(hits)?.externalId).toBe("a");
    expect(pickClosestByDuration(hits, Number.NaN)?.externalId).toBe("a");
    expect(pickClosestByDuration([])).toBeNull();
  });
});
