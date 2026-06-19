import { describe, expect, it } from "vitest";
import type { Memory, Track } from "@/db/types";
import { buildGlobalSearchLocalResults } from "./global-search-local-core";

describe("buildGlobalSearchLocalResults", () => {
  it("returns compact ids/entities without carrying full track rows back to the UI", () => {
    const tracks = [
      makeTrack("trk_old", "Old Song", 1),
      makeTrack("trk_memory", "Quiet Track", 2),
      makeTrack("trk_album", "Love Album Song", 3, {
        album: "Blue Love",
        artists: ["Love Aki"],
        coverBlobId: "blb_cover",
      }),
    ];
    const memories: Memory[] = [
      {
        id: "mem_1",
        createdAt: 1,
        note: "summer love note",
        trackId: "trk_memory",
      },
    ];

    const results = buildGlobalSearchLocalResults(tracks, memories, {
      includeAlbums: true,
      includeArtists: true,
      includeTracks: true,
      query: "love",
      resultLimit: 4,
    });

    expect(results.trackIds).toContain("trk_memory");
    expect(results.trackIds).toContain("trk_album");
    expect(results.albums.map((entry) => entry.name)).toContain("Blue Love");
    expect(results.artists.map((entry) => entry.name)).toContain("Love Aki");
    expect(results.coverTrackIds).toEqual(["trk_album"]);
  });
});

function makeTrack(
  id: string,
  title: string,
  createdAt: number,
  metadata: {
    album?: string;
    artists?: string[];
    coverBlobId?: string;
  } = {},
): Track {
  return {
    coverBlobId: metadata.coverBlobId,
    createdAt,
    durationSec: 60,
    id,
    kind: "audio",
    liked: false,
    mediaMetadata: {
      album: metadata.album,
      artists: metadata.artists,
      parsedAt: createdAt,
      parser: "manual",
      title,
    },
    origin: "uploaded",
    playCount: 0,
    provider: "upload",
    sessionId: "ses_1",
    status: "ready",
    tags: [],
    title,
  };
}
