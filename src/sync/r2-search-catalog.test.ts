import { beforeAll, describe, expect, it } from "vitest";
import { ensureTransliterationLoaded } from "@/lib/search-transliterate";
import {
  matchesRemoteSearchTrack,
  r2SearchCatalogSchema,
  r2TrackSearchPageSchema,
  remoteSearchSetToRow,
  remoteSearchTrackToRow,
} from "./r2-search-catalog";

// Remote matching shares the transliteration engine; warm it so pinyin/romaji
// assertions resolve (substring behavior holds before load — no regression).
beforeAll(async () => {
  await ensureTransliterationLoaded();
});

describe("r2 search catalog schemas", () => {
  it("parses a catalog page manifest", () => {
    const catalog = r2SearchCatalogSchema.parse({
      schema: "muzero-r2-search-catalog-v1",
      libraryId: "lib_abc",
      updatedAt: "2026-06-09T00:00:00.000Z",
      locale: "en",
      pages: {
        sets: ["catalog/sets-page-0001.json"],
        tracks: ["catalog/tracks-page-0001.json"],
        shares: ["catalog/shares-page-0001.json"],
      },
      counts: {
        sets: 120,
        tracks: 14000,
        shares: 24,
      },
    });

    expect(catalog.pages.tracks).toEqual(["catalog/tracks-page-0001.json"]);
  });

  it("parses a track search page", () => {
    const page = r2TrackSearchPageSchema.parse({
      schema: "muzero-r2-track-search-page-v1",
      page: 1,
      updatedAt: "2026-06-09T00:00:00.000Z",
      tracks: [
        {
          id: "trk_blue",
          title: "Blue Highway",
          setIds: ["ses_tokyo"],
          shareIds: ["shr_tokyo"],
          kind: "audio",
          origin: "uploaded",
          durationSec: 214,
          tags: ["night", "drive"],
          mediaMetadata: {
            album: "Moonstone Beach",
            artists: ["Deidian"],
            genres: ["soluna"],
            parser: "music-metadata",
            parsedAt: 1780944000000,
            title: "Blue Highway",
            year: 2026,
          },
          memoryText: "friends sea night",
          briefCaption: null,
          artistLike: null,
          updatedAt: 1780944000000,
          mediaAvailable: true,
          coverUrl: "objects/covers/trk_blue.jpg",
        },
      ],
    });

    expect(page.tracks[0]?.tags).toEqual(["night", "drive"]);
  });
});

describe("remote search row normalization", () => {
  const remoteTrack = {
    id: "trk_blue",
    title: "Blue Highway",
    setIds: ["ses_tokyo"],
    shareIds: ["shr_tokyo"],
    kind: "audio" as const,
    origin: "uploaded" as const,
    durationSec: 214,
    tags: ["night", "drive"],
    mediaMetadata: {
      album: "Moonstone Beach",
      artists: ["Deidian"],
      genres: ["soluna"],
      parser: "music-metadata" as const,
      parsedAt: 1780944000000,
      title: "Blue Highway",
      year: 2026,
    },
    memoryText: "朋友 sea night",
    briefCaption: "lofi city pop",
    artistLike: null,
    updatedAt: 1780944000000,
    mediaAvailable: true,
    coverUrl: "objects/covers/trk_blue.jpg",
  };

  it("builds a stable local row id scoped by catalog", () => {
    const row = remoteSearchTrackToRow({
      catalogId: "drv_a:lib_abc",
      driveId: "drv_a",
      track: remoteTrack,
    });

    expect(row.id).toBe("drv_a:lib_abc:trk_blue");
    expect(row.normalizedText).toContain("blue highway");
    expect(row.normalizedText).toContain("lofi city pop");
    expect(row.normalizedText).toContain("deidian");
    expect(row.normalizedText).toContain("moonstone beach");
  });

  it("matches normal text and tag-only queries", () => {
    const row = remoteSearchTrackToRow({
      catalogId: "drv_a:lib_abc",
      driveId: "drv_a",
      track: remoteTrack,
    });

    expect(matchesRemoteSearchTrack(row, "blue sea")).toBe(true);
    expect(matchesRemoteSearchTrack(row, "deidian soluna")).toBe(true);
    expect(matchesRemoteSearchTrack(row, "朋友")).toBe(true);
    expect(matchesRemoteSearchTrack(row, "pengyou")).toBe(true); // 朋友 via pinyin (folded memory text)
    expect(matchesRemoteSearchTrack(row, "#drive")).toBe(true);
    expect(matchesRemoteSearchTrack(row, "#sea")).toBe(false); // tag scope: "sea" isn't a tag
    expect(matchesRemoteSearchTrack(row, "artist:nobody")).toBe(false); // artist scope, no match
  });

  it("builds searchable set rows", () => {
    const row = remoteSearchSetToRow({
      catalogId: "drv_a:lib_abc",
      driveId: "drv_a",
      set: {
        id: "ses_tokyo",
        name: "Tokyo Night Drive",
        description: "Rainy city pop",
        trackCount: 24,
        updatedAt: 1780944000000,
        coverUrl: "objects/covers/set.jpg",
      },
    });

    expect(row.id).toBe("drv_a:lib_abc:ses_tokyo");
    expect(row.normalizedText).toContain("tokyo night drive");
    expect(row.normalizedText).toContain("rainy city pop");
  });
});
