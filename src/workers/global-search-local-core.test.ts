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

  it("filters local tracks by mediaKind (@Video / @Audio)", () => {
    const tracks = [
      makeTrack("trk_audio", "Live Audio", 1),
      makeTrack("trk_video", "Live Video", 2, { kind: "video" }),
    ];

    const video = buildGlobalSearchLocalResults(tracks, [], {
      includeAlbums: false,
      includeArtists: false,
      includeTracks: true,
      query: "live",
      resultLimit: 8,
      mediaKind: "video",
    });
    expect(video.trackIds).toEqual(["trk_video"]);

    const audio = buildGlobalSearchLocalResults(tracks, [], {
      includeAlbums: false,
      includeArtists: false,
      includeTracks: true,
      query: "live",
      resultLimit: 8,
      mediaKind: "audio",
    });
    expect(audio.trackIds).toEqual(["trk_audio"]);
  });

  it("applies the mediaKind predicate BEFORE slicing to resultLimit", () => {
    // 4 NEWER audio tracks + 6 video tracks. With the predicate applied before the
    // slice we get the newest `resultLimit` VIDEO ids; if it were applied after the
    // slice, the newest-by-createdAt rows (all audio) would fill — then be filtered
    // out — leaving fewer than resultLimit. No query → browse mode.
    const tracks = [
      ...[0, 1, 2, 3].map((i) => makeTrack(`trk_audio_${i}`, `Audio ${i}`, 100 + i)),
      ...[0, 1, 2, 3, 4, 5].map((i) =>
        makeTrack(`trk_video_${i}`, `Video ${i}`, 10 + i, {
          kind: "video",
        }),
      ),
    ];

    const results = buildGlobalSearchLocalResults(tracks, [], {
      includeAlbums: false,
      includeArtists: false,
      includeTracks: true,
      query: "",
      resultLimit: 4,
      mediaKind: "video",
    });

    expect(results.trackIds).toHaveLength(4);
    expect(results.trackIds.every((id) => id.startsWith("trk_video_"))).toBe(true);
    // Newest-first within the video set: createdAt 15,14,13,12 → indices 5,4,3,2.
    expect(results.trackIds).toEqual(["trk_video_5", "trk_video_4", "trk_video_3", "trk_video_2"]);
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
    kind?: Track["kind"];
  } = {},
): Track {
  return {
    coverBlobId: metadata.coverBlobId,
    createdAt,
    durationSec: 60,
    id,
    kind: metadata.kind ?? "audio",
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
