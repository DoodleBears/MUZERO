import { describe, expect, it } from "vitest";
import {
  buildLyricBody,
  parseNeteaseLyric,
  pickBestSong,
  pickClosestByDuration,
} from "./netease-lyric-map";

describe("buildLyricBody", () => {
  it("builds the eapi lyric request body for a song id (yrc + translation + roman)", () => {
    expect(buildLyricBody("33894312")).toEqual({
      id: "33894312",
      cp: false,
      lv: 0,
      kv: 0,
      tv: 0,
      yv: 0,
      rv: 0,
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

  it("prefers word-level yrc over line-level lrc when present", () => {
    const json = {
      yrc: { lyric: "[1000,800](1000,300,0)Hello (1300,250,0)world" },
      lrc: { lyric: "[00:01.00]Hello world" },
    };
    expect(parseNeteaseLyric(json)).toEqual({
      synced: "[1000,800](1000,300,0)Hello (1300,250,0)world",
      format: "yrc",
      instrumental: false,
    });
  });

  it("falls back to lrc when yrc is empty or just credit metadata", () => {
    const json = {
      yrc: { lyric: '{"c":[{"tx":"作词: "},{"tx":"x"}]}' },
      lrc: { lyric: "[00:01.00]Hello world" },
    };
    expect(parseNeteaseLyric(json)).toEqual({
      synced: "[00:01.00]Hello world",
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

  it("attaches translation (tlyric) and romanization (romalrc) when present", () => {
    const json = {
      lrc: { lyric: "[00:12.34]故事的小黄花" },
      tlyric: { lyric: "[00:12.34]The little yellow flower" },
      romalrc: { lyric: "[00:12.34]gushi de xiao huanghua" },
    };
    expect(parseNeteaseLyric(json)).toEqual({
      synced: "[00:12.34]故事的小黄花",
      translation: "[00:12.34]The little yellow flower",
      romanization: "[00:12.34]gushi de xiao huanghua",
      instrumental: false,
    });
  });

  it("ignores empty / timestamp-less translation tracks", () => {
    const json = {
      lrc: { lyric: "[00:01.00]line" },
      tlyric: { lyric: "" },
      romalrc: { lyric: "no timestamps" },
    };
    expect(parseNeteaseLyric(json)).toEqual({
      synced: "[00:01.00]line",
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

describe("pickBestSong", () => {
  const song = (externalId: string, title: string, durationSec: number) => ({
    externalId,
    title,
    durationSec,
  });

  it("prefers the title-matching song even when another is closer in duration", () => {
    const songs = [song("a", "Totally Different", 200), song("b", "Blue Highway", 260)];
    const best = pickBestSong(songs, {
      trackName: "Blue Highway",
      artistName: "x",
      durationSec: 210,
    });
    expect(best?.externalId).toBe("b");
  });

  it("uses duration to disambiguate same-title songs", () => {
    const songs = [song("a", "Hello", 180), song("b", "Hello", 240)];
    const best = pickBestSong(songs, { trackName: "Hello", artistName: "x", durationSec: 238 });
    expect(best?.externalId).toBe("b");
  });

  it("returns null for an empty list", () => {
    expect(pickBestSong([], { trackName: "x", artistName: "y" })).toBeNull();
  });
});
