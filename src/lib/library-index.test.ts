import { describe, expect, it } from "vitest";
import type { Track, TrackMediaMetadata } from "@/db/types";
import {
  type AlbumEntry,
  type ArtistEntry,
  buildAlbumIndex,
  buildArtistIndex,
} from "./library-index";
import { normalizeArtistName, trackAlbum, trackArtists } from "./track-display";

function track(partial: Partial<Track>): Track {
  return {
    id: "t",
    sessionId: "s",
    title: "Untitled",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 30,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    ...partial,
  };
}

function md(partial: Partial<TrackMediaMetadata>): TrackMediaMetadata {
  return { parser: "music-metadata", parsedAt: 1, ...partial };
}

const byKey = <T extends { key: string }>(entries: T[]) => new Map(entries.map((e) => [e.key, e]));

describe("normalizeArtistName", () => {
  it("trims, lowercases, and collapses internal whitespace", () => {
    expect(normalizeArtistName("  DoubleJ   姜峰 ")).toBe("doublej 姜峰");
    expect(normalizeArtistName("DEIDIAN")).toBe("deidian");
  });
  it("leaves CJK intact", () => {
    expect(normalizeArtistName("懒人的午后")).toBe("懒人的午后");
  });
});

describe("trackArtists / trackAlbum", () => {
  it("returns artists, falling back to albumArtists when artists is empty", () => {
    expect(trackArtists(track({ mediaMetadata: md({ artists: ["A", "B"] }) }))).toEqual(["A", "B"]);
    expect(trackArtists(track({ mediaMetadata: md({ albumArtists: ["VA"] }) }))).toEqual(["VA"]);
  });
  it("returns [] for a generated/brief-only track with no metadata", () => {
    expect(
      trackArtists(track({ origin: "generated", provider: "mock", mediaMetadata: undefined })),
    ).toEqual([]);
  });
  it("reads the album, trimming, else undefined", () => {
    expect(trackAlbum(track({ mediaMetadata: md({ album: " Moonstone " }) }))).toBe("Moonstone");
    expect(trackAlbum(track({ mediaMetadata: undefined }))).toBeUndefined();
  });
});

describe("buildArtistIndex", () => {
  it("a feat. track joins every artist it credits", () => {
    const t = track({ id: "x", mediaMetadata: md({ artists: ["Alice", "Bob"] }) });
    const idx = buildArtistIndex([t]);
    const keys = idx.filter((e) => !e.bucket).map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(["alice", "bob"]));
    expect(byKey(idx).get("alice")?.trackIds).toEqual(["x"]);
    expect(byKey(idx).get("bob")?.trackIds).toEqual(["x"]);
  });

  it("collapses casings under one entry, displaying the most frequent spelling", () => {
    const idx = buildArtistIndex([
      track({ id: "1", mediaMetadata: md({ artists: ["DoubleJ"] }) }),
      track({ id: "2", mediaMetadata: md({ artists: ["doublej"] }) }),
      track({ id: "3", mediaMetadata: md({ artists: ["DoubleJ"] }) }),
    ]);
    const entry = byKey(idx).get("doublej");
    expect(entry?.name).toBe("DoubleJ");
    expect(entry?.trackIds).toEqual(["1", "2", "3"]);
  });

  it("buckets tag-less uploads under an 'unknown' pseudo-artist, sorted to the end", () => {
    const idx = buildArtistIndex([
      track({ id: "u", mediaMetadata: undefined }),
      track({ id: "z", mediaMetadata: md({ artists: ["Aaa"] }) }),
    ]);
    const unknown = idx.find((e) => e.bucket === "unknown");
    expect(unknown?.trackIds).toEqual(["u"]);
    expect(idx.at(-1)?.bucket).toBe("unknown");
    expect(idx.findIndex((e) => e.bucket === "unknown")).toBeGreaterThan(
      idx.findIndex((e) => e.key === "aaa"),
    );
  });

  it("buckets generated tracks under a 'generated' pseudo-artist", () => {
    const idx = buildArtistIndex([
      track({ id: "g", origin: "generated", provider: "mock", mediaMetadata: undefined }),
    ]);
    const generated = idx.find((e) => e.bucket === "generated");
    expect(generated?.trackIds).toEqual(["g"]);
    // generated tracks are NOT in the Unknown bucket
    expect(idx.some((e) => e.bucket === "unknown")).toBe(false);
  });

  it("sums duration and lists album keys + a cover fallback", () => {
    const idx = buildArtistIndex([
      track({
        id: "1",
        durationSec: 100,
        coverBlobId: undefined,
        mediaMetadata: md({ artists: ["Yumi"], album: "One" }),
      }),
      track({
        id: "2",
        durationSec: 50,
        coverBlobId: "blb1",
        mediaMetadata: md({ artists: ["Yumi"], album: "Two" }),
      }),
    ]);
    const yumi = byKey(idx).get("yumi");
    expect(yumi?.totalDurationSec).toBe(150);
    expect(yumi?.coverTrackId).toBe("2");
    expect(yumi?.albumKeys.length).toBe(2);
  });

  it("real artists sort alphabetically before pseudo buckets", () => {
    const idx = buildArtistIndex([
      track({ id: "u", mediaMetadata: undefined }),
      track({ id: "z", mediaMetadata: md({ artists: ["Zed"] }) }),
      track({ id: "a", mediaMetadata: md({ artists: ["Ann"] }) }),
    ]);
    const real = idx.filter((e) => !e.bucket).map((e) => e.key);
    expect(real).toEqual(["ann", "zed"]);
  });
});

describe("buildAlbumIndex", () => {
  it("keeps same-titled albums by different artists separate (namespaced by album artist)", () => {
    const idx = buildAlbumIndex([
      track({ id: "1", mediaMetadata: md({ album: "Greatest Hits", albumArtists: ["Queen"] }) }),
      track({ id: "2", mediaMetadata: md({ album: "Greatest Hits", albumArtists: ["ABBA"] }) }),
    ]);
    const real = idx.filter((e) => !e.bucket);
    expect(real.length).toBe(2);
    expect(real.map((e) => e.artistName).sort()).toEqual(["ABBA", "Queen"]);
  });

  it("orders an album's tracks by (diskNo, trackNo, title)", () => {
    const idx = buildAlbumIndex([
      track({ id: "b", mediaMetadata: md({ album: "LP", albumArtists: ["X"], trackNo: 2 }) }),
      track({ id: "a", mediaMetadata: md({ album: "LP", albumArtists: ["X"], trackNo: 1 }) }),
      track({
        id: "c",
        mediaMetadata: md({ album: "LP", albumArtists: ["X"], diskNo: 2, trackNo: 1 }),
      }),
    ]);
    const lp = idx.find((e) => !e.bucket);
    expect(lp?.trackIds).toEqual(["a", "b", "c"]);
  });

  it("groups a compilation (same album, differing artists, no album artist) under one Various-Artists album", () => {
    const idx = buildAlbumIndex([
      track({ id: "1", mediaMetadata: md({ album: "Now 100", artists: ["Alpha"] }) }),
      track({ id: "2", mediaMetadata: md({ album: "Now 100", artists: ["Beta"] }) }),
    ]);
    const real = idx.filter((e) => !e.bucket);
    expect(real.length).toBe(1);
    expect(real[0].isCompilation).toBe(true);
    expect(real[0].trackIds.sort()).toEqual(["1", "2"]);
  });

  it("explicit album artist holds a multi-artist album together (not a compilation)", () => {
    const idx = buildAlbumIndex([
      track({
        id: "1",
        mediaMetadata: md({ album: "Duets", artists: ["Alpha"], albumArtists: ["Alpha"] }),
      }),
      track({
        id: "2",
        mediaMetadata: md({ album: "Duets", artists: ["Beta"], albumArtists: ["Alpha"] }),
      }),
    ]);
    const real = idx.filter((e) => !e.bucket);
    expect(real.length).toBe(1);
    expect(real[0].isCompilation).toBeFalsy();
    expect(real[0].artistName).toBe("Alpha");
  });

  it("buckets album-less tracks under an 'unknown' album, sorted to the end", () => {
    const idx = buildAlbumIndex([
      track({ id: "n", mediaMetadata: md({ artists: ["Solo"] }) }),
      track({ id: "y", mediaMetadata: md({ album: "Real", albumArtists: ["A"] }) }),
    ]);
    expect(idx.at(-1)?.bucket).toBe("unknown");
    expect(byKey(idx).get(idx.at(-1)?.key ?? "")?.trackIds).toEqual(["n"]);
  });

  it("excludes generated brief-only tracks from albums entirely", () => {
    const idx = buildAlbumIndex([
      track({ id: "g", origin: "generated", provider: "mock", mediaMetadata: undefined }),
    ]);
    expect(idx).toEqual([]);
  });

  it("carries year (display-only) and a cover fallback", () => {
    const idx = buildAlbumIndex([
      track({
        id: "1",
        coverBlobId: "blb",
        mediaMetadata: md({ album: "Y", albumArtists: ["A"], year: 2021 }),
      }),
    ]);
    const entry = idx.find((e) => !e.bucket) as AlbumEntry;
    expect(entry.year).toBe(2021);
    expect(entry.coverTrackId).toBe("1");
  });
});

// Type-only guard: the index entries expose what the UI needs.
const _artistShape: ArtistEntry = {
  key: "k",
  name: "n",
  trackIds: [],
  albumKeys: [],
  totalDurationSec: 0,
};
void _artistShape;
