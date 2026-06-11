import { describe, expect, it } from "vitest";
import { matchFilterOptions, parseMention } from "./global-search-filter";

describe("parseMention", () => {
  it("is inactive for empty input and plain text", () => {
    expect(parseMention("")).toEqual({ active: false, partial: "", before: "" });
    expect(parseMention("love song")).toEqual({
      active: false,
      partial: "",
      before: "love song",
    });
  });

  it("activates on a bare @", () => {
    expect(parseMention("@")).toEqual({ active: true, partial: "", before: "" });
  });

  it("captures the partial after @ at the start", () => {
    expect(parseMention("@art")).toEqual({ active: true, partial: "art", before: "" });
  });

  it("preserves free text before the mention", () => {
    expect(parseMention("love @art")).toEqual({ active: true, partial: "art", before: "love " });
  });

  it("only triggers on a leading/whitespace boundary (not mid-word)", () => {
    expect(parseMention("art@home").active).toBe(false);
  });

  it("closes once a space follows the mention", () => {
    expect(parseMention("@art ").active).toBe(false);
  });

  it("tracks the trailing mention when several @tokens are present", () => {
    expect(parseMention("a @b @c")).toEqual({ active: true, partial: "c", before: "a @b " });
  });
});

describe("matchFilterOptions", () => {
  it("returns every option for an empty partial", () => {
    expect(matchFilterOptions("").map((o) => o.id)).toEqual(["artist", "album", "bili", "netease"]);
  });

  it("prefix-matches latin aliases", () => {
    expect(matchFilterOptions("art").map((o) => o.id)).toEqual(["artist"]);
    expect(matchFilterOptions("alb").map((o) => o.id)).toEqual(["album"]);
    expect(matchFilterOptions("bil").map((o) => o.id)).toEqual(["bili"]);
    expect(matchFilterOptions("net").map((o) => o.id)).toEqual(["netease"]);
  });

  it("prefix-matches CJK aliases", () => {
    expect(matchFilterOptions("歌").map((o) => o.id)).toEqual(["artist"]);
    expect(matchFilterOptions("专辑").map((o) => o.id)).toEqual(["album"]);
    expect(matchFilterOptions("网易").map((o) => o.id)).toEqual(["netease"]);
  });

  it("is case-insensitive", () => {
    expect(matchFilterOptions("ALB").map((o) => o.id)).toEqual(["album"]);
  });

  it("respects a pre-filtered option list (e.g. no sources off-desktop)", () => {
    const local = matchFilterOptions("", [
      { id: "artist", filter: { kind: "artist" }, aliases: ["artist"] },
      { id: "album", filter: { kind: "album" }, aliases: ["album"] },
    ]);
    expect(local.map((o) => o.id)).toEqual(["artist", "album"]);
  });

  it("returns nothing for an unmatched partial", () => {
    expect(matchFilterOptions("zzz")).toEqual([]);
  });
});
