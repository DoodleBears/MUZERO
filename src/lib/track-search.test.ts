import { beforeAll, describe, expect, it } from "vitest";
import type { Track, TrackMediaMetadata } from "@/db/types";
import { buildAlbumIndex, buildArtistIndex } from "./library-index";
import { ensureTransliterationLoaded } from "./search-transliterate";
import {
  findLyricSearchMatch,
  lyricsSearchFields,
  matchesQuery,
  parseSearchTokens,
  searchEntityFacets,
  searchTracks,
  trackSearchScore,
  tracksWithTag,
} from "./track-search";

// Matching routes through the transliteration engine; warm the pinyin/kana libs
// once so pinyin/romaji assertions resolve synchronously (substring-only
// behavior holds before load, which the pre-transliteration tests rely on).
beforeAll(async () => {
  await ensureTransliterationLoaded();
});

function track(partial: Partial<Track>): Track {
  return {
    id: "t",
    sessionId: "s",
    title: "Untitled",
    kind: "audio",
    origin: "generated",
    provider: "mock",
    status: "ready",
    durationSec: 30,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    ...partial,
  };
}

const neonRain = track({
  id: "a",
  title: "Neon Rain",
  brief: { title: "Neon Rain", caption: "lofi hip hop, mellow piano", lyrics: "", durationSec: 60 },
  note: "summer 2019 road trip with mom",
  tags: ["roadtrip", "nostalgia"],
});
const workout = track({
  id: "b",
  title: "Sprint",
  brief: undefined,
  note: "gym",
  tags: ["workout"],
});

describe("matchesQuery", () => {
  it("matches across title, caption, note, and tags", () => {
    expect(matchesQuery(neonRain, "neon")).toBe(true); // title
    expect(matchesQuery(neonRain, "piano")).toBe(true); // caption
    expect(matchesQuery(neonRain, "road trip")).toBe(true); // note (two tokens, both present)
    expect(matchesQuery(neonRain, "nostalgia")).toBe(true); // tag
    expect(matchesQuery(neonRain, "techno")).toBe(false);
  });

  it("matches imported media metadata", () => {
    const imported = track({
      brief: undefined,
      mediaMetadata: {
        album: "Moonstone Beach",
        artists: ["Deidian"],
        genres: ["soluna"],
        parser: "music-metadata",
        parsedAt: 1,
        year: 2026,
      },
      origin: "uploaded",
      title: "Track 04",
    });
    expect(matchesQuery(imported, "deidian")).toBe(true);
    expect(matchesQuery(imported, "moonstone 2026")).toBe(true);
    expect(matchesQuery(imported, "soluna")).toBe(true);
  });

  it("requires every token to match (AND)", () => {
    expect(matchesQuery(neonRain, "summer mom")).toBe(true);
    expect(matchesQuery(neonRain, "summer techno")).toBe(false);
  });

  it("treats #tag as a tag-only match", () => {
    expect(matchesQuery(neonRain, "#roadtrip")).toBe(true);
    expect(matchesQuery(workout, "#roadtrip")).toBe(false);
    // 'workout' appears as a tag, not in #road
    expect(matchesQuery(workout, "#workout")).toBe(true);
  });

  it("empty query matches everything", () => {
    expect(matchesQuery(workout, "   ")).toBe(true);
  });
});

describe("matchesQuery with memories", () => {
  // After the v4 migration, recollections live in the memories table — passed in
  // as notes rather than read off `track.note`.
  const song = track({ id: "c", title: "Drift", note: undefined, tags: ["chill"] });

  it("matches text found in a passed-in memory note", () => {
    expect(matchesQuery(song, "okinawa")).toBe(false); // not in any track field
    expect(matchesQuery(song, "okinawa", ["beach day in okinawa"])).toBe(true);
  });

  it("ANDs tokens across track fields and memory notes", () => {
    expect(matchesQuery(song, "drift okinawa", ["beach day in okinawa"])).toBe(true);
    expect(matchesQuery(song, "drift tokyo", ["beach day in okinawa"])).toBe(false);
  });

  it("still scopes #tag to tags, never memory notes", () => {
    expect(matchesQuery(song, "#beach", ["beach day in okinawa"])).toBe(false);
    expect(matchesQuery(song, "#chill", ["beach day in okinawa"])).toBe(true);
  });
});

describe("lyricsSearchFields", () => {
  it("indexes generated brief lyrics", () => {
    const song = track({
      brief: { title: "T", caption: "c", lyrics: "meet me under the skylight", durationSec: 60 },
    });
    expect(lyricsSearchFields(song)).toContain("meet me under the skylight");
  });

  it("indexes stored plain and parsed synced lyric text", () => {
    const fields = lyricsSearchFields(neonRain, {
      status: "found",
      instrumental: false,
      plain: "plain chorus line",
      synced: "[00:12.34]故事的小黄花\n[00:15.00]I feel your breath",
    });
    expect(fields).toContain("plain chorus line");
    expect(fields).toContain("故事的小黄花");
    expect(fields).toContain("I feel your breath");
  });

  it("does not index lyrics for instrumental records", () => {
    const song = track({
      brief: { title: "T", caption: "c", lyrics: "hidden words", durationSec: 60 },
    });
    expect(
      lyricsSearchFields(song, {
        status: "instrumental",
        instrumental: true,
      }),
    ).toEqual([]);
  });
});

describe("findLyricSearchMatch", () => {
  it("returns the matching synced line with timestamp", () => {
    const match = findLyricSearchMatch(
      neonRain,
      {
        status: "found",
        instrumental: false,
        synced: "[00:12.34]故事的小黄花\n[00:15.00]I feel your breath",
      },
      "breath",
    );
    expect(match).toEqual({ text: "I feel your breath", timeSec: 15 });
  });

  it("returns a plain lyric line when there is no timestamp", () => {
    const match = findLyricSearchMatch(
      neonRain,
      {
        status: "found",
        instrumental: false,
        plain: "first line\nsecond chorus",
      },
      "chorus",
    );
    expect(match).toEqual({ text: "second chorus" });
  });
});

describe("searchTracks", () => {
  it("filters the list by query", () => {
    const all = [neonRain, workout];
    expect(searchTracks(all, "road").map((t) => t.id)).toEqual(["a"]);
    expect(searchTracks(all, "").length).toBe(2);
  });

  it("joins per-track memory notes from the map when filtering", () => {
    const all = [neonRain, workout];
    const memories = new Map<string, string[]>([["b", ["leg day PR in osaka"]]]);
    expect(searchTracks(all, "osaka", memories).map((t) => t.id)).toEqual(["b"]);
    // without the memory map, "osaka" matches nothing
    expect(searchTracks(all, "osaka").length).toBe(0);
  });
});

describe("tracksWithTag", () => {
  it("returns tracks carrying an exact tag", () => {
    expect(tracksWithTag([neonRain, workout], "workout").map((t) => t.id)).toEqual(["b"]);
  });
});

const md = (partial: Partial<TrackMediaMetadata>): TrackMediaMetadata => ({
  parser: "music-metadata",
  parsedAt: 1,
  ...partial,
});

describe("parseSearchTokens", () => {
  it("splits scoped field tokens from free text", () => {
    expect(parseSearchTokens("DoubleJ artist:yumi album:moon #chill")).toEqual({
      free: ["doublej"],
      artist: ["yumi"],
      album: ["moon"],
      tags: ["chill"],
    });
  });
});

describe("matchesQuery — scoped tokens", () => {
  const song = track({
    id: "s",
    title: "Blue",
    brief: undefined,
    origin: "uploaded",
    mediaMetadata: md({ artists: ["Deidian"], album: "Moonstone Beach" }),
  });
  it("artist: scopes to the artist field", () => {
    expect(matchesQuery(song, "artist:deidian")).toBe(true);
    expect(matchesQuery(song, "artist:moonstone")).toBe(false); // album, not artist
  });
  it("album: scopes to the album field", () => {
    expect(matchesQuery(song, "album:moonstone")).toBe(true);
    expect(matchesQuery(song, "album:deidian")).toBe(false);
  });
  it("composes scoped + free + tags (AND)", () => {
    expect(matchesQuery(song, "blue artist:deidian")).toBe(true);
    expect(matchesQuery(song, "blue artist:nobody")).toBe(false);
  });
});

describe("searchEntityFacets", () => {
  const tracks = [
    track({
      id: "1",
      origin: "uploaded",
      mediaMetadata: md({ artists: ["Deidian"], album: "Moonstone Beach" }),
    }),
    track({
      id: "2",
      origin: "uploaded",
      mediaMetadata: md({ artists: ["Yumi"], album: "Night Drive" }),
    }),
  ];
  const artists = buildArtistIndex(tracks);
  const albums = buildAlbumIndex(tracks);

  it("surfaces matching artists and albums for free text", () => {
    const facets = searchEntityFacets(artists, albums, "moon");
    expect(facets.albums.map((a) => a.name)).toEqual(["Moonstone Beach"]);
    expect(facets.artists).toEqual([]); // "moon" isn't in any artist name
  });

  it("scoped tokens populate only their facet", () => {
    expect(
      searchEntityFacets(artists, albums, "artist:deidian").artists.map((a) => a.name),
    ).toEqual(["Deidian"]);
    expect(searchEntityFacets(artists, albums, "artist:deidian").albums).toEqual([]);
    expect(searchEntityFacets(artists, albums, "album:night").albums.map((a) => a.name)).toEqual([
      "Night Drive",
    ]);
  });

  it("empty query yields no facet hits", () => {
    expect(searchEntityFacets(artists, albums, "")).toEqual({ artists: [], albums: [] });
  });
});

describe("matchesQuery — transliteration (pinyin / kana / romaji)", () => {
  const cnTrack = track({ id: "cn", title: "北京欢迎你", brief: undefined, tags: ["旅行"] });
  const jpTrack = track({
    id: "jp",
    title: "ナルト",
    brief: undefined,
    origin: "uploaded",
    mediaMetadata: md({ artists: ["周杰伦"], album: "范特西" }),
  });

  it("matches Chinese titles by full pinyin and initials", () => {
    expect(matchesQuery(cnTrack, "beijing")).toBe(true); // full pinyin prefix
    expect(matchesQuery(cnTrack, "bjhyn")).toBe(true); // 首字母 initials
    expect(matchesQuery(cnTrack, "北京")).toBe(true); // original substring still works
    expect(matchesQuery(cnTrack, "shanghai")).toBe(false);
  });

  it("matches Chinese tags by pinyin (#lvxing / #lx → #旅行)", () => {
    expect(matchesQuery(cnTrack, "#lvxing")).toBe(true);
    expect(matchesQuery(cnTrack, "#lx")).toBe(true);
    expect(matchesQuery(cnTrack, "#旅行")).toBe(true);
    expect(matchesQuery(cnTrack, "#workout")).toBe(false);
  });

  it("matches Japanese titles by romaji", () => {
    expect(matchesQuery(jpTrack, "naruto")).toBe(true);
  });

  it("matches scoped artist/album by pinyin", () => {
    expect(matchesQuery(jpTrack, "artist:zhoujielun")).toBe(true);
    expect(matchesQuery(jpTrack, "artist:zjl")).toBe(true);
    expect(matchesQuery(jpTrack, "album:fantexi")).toBe(true);
    expect(matchesQuery(jpTrack, "artist:nobody")).toBe(false);
  });
});

describe("trackSearchScore + ranked searchTracks", () => {
  const exact = track({ id: "x", title: "Drive", brief: undefined });
  const buried = track({
    id: "y",
    title: "Long Distance",
    brief: undefined,
    note: "a long drive home",
  });

  it("scores a closer match lower (better) than a buried one", () => {
    expect(trackSearchScore(exact, "drive")).toBeLessThan(trackSearchScore(buried, "drive"));
  });

  it("ranks exact/prefix title matches above buried matches", () => {
    const ranked = searchTracks([buried, exact], "drive"); // input order puts buried first
    expect(ranked.map((t) => t.id)).toEqual(["x", "y"]); // exact floats up, both kept
  });

  it("returns 0 for an empty query and preserves input order", () => {
    expect(trackSearchScore(exact, "   ")).toBe(0);
    expect(searchTracks([buried, exact], "").map((t) => t.id)).toEqual(["y", "x"]);
  });
});

describe("searchEntityFacets — transliteration", () => {
  const cnTracks = [
    track({
      id: "1",
      origin: "uploaded",
      mediaMetadata: md({ artists: ["周杰伦"], album: "范特西" }),
    }),
  ];
  const cnArtists = buildArtistIndex(cnTracks);
  const cnAlbums = buildAlbumIndex(cnTracks);

  it("surfaces a Chinese artist by full pinyin and initials", () => {
    expect(
      searchEntityFacets(cnArtists, cnAlbums, "zhoujielun").artists.map((a) => a.name),
    ).toEqual(["周杰伦"]);
    expect(searchEntityFacets(cnArtists, cnAlbums, "zjl").artists.map((a) => a.name)).toEqual([
      "周杰伦",
    ]);
  });

  it("surfaces a Chinese album by pinyin", () => {
    expect(
      searchEntityFacets(cnArtists, cnAlbums, "album:fantexi").albums.map((a) => a.name),
    ).toEqual(["范特西"]);
  });
});
