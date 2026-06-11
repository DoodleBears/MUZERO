import { describe, expect, it } from "vitest";
import {
  r2ManifestSchema,
  r2SetIndexSchema,
  r2ShareManifestSchema,
  r2StatsSchema,
} from "./r2-manifest-schema";

describe("r2ManifestSchema", () => {
  it("parses a minimal library manifest", () => {
    const manifest = r2ManifestSchema.parse({
      schema: "muzero-r2-manifest-v1",
      libraryId: "lib_abc",
      title: "Doodle Drive",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
      baseUrl: "https://music.example.com/muzero/",
      sets: [
        {
          id: "ses_tokyo",
          title: "Tokyo Night Drive",
          index: "sets/ses_tokyo/index.json",
          updatedAt: "2026-06-09T00:00:00.000Z",
          trackCount: 2,
          bytes: 1234,
        },
      ],
    });

    expect(manifest.sets[0]?.index).toBe("sets/ses_tokyo/index.json");
  });

  it("rejects the wrong schema version", () => {
    expect(() =>
      r2ManifestSchema.parse({
        schema: "muzero-r2-manifest-v2",
        libraryId: "lib_abc",
        title: "Doodle Drive",
        createdAt: "2026-06-09T00:00:00.000Z",
        updatedAt: "2026-06-09T00:00:00.000Z",
        baseUrl: "https://music.example.com/muzero/",
        sets: [],
      }),
    ).toThrow();
  });
});

describe("r2SetIndexSchema", () => {
  it("parses audio/video tracks with covers and memories", () => {
    const setIndex = r2SetIndexSchema.parse({
      schema: "muzero-r2-set-index-v1",
      revision: 3,
      set: {
        id: "ses_tokyo",
        name: "Tokyo Night Drive",
        seedPrompt: "rainy Tokyo night drive",
        displayMode: "video",
        config: {
          autoExtend: true,
          refillThreshold: 2,
          batchSize: 1,
          targetDurationSec: 60,
          allowVocals: true,
        },
        createdAt: 1780944000000,
        updatedAt: 1780944000000,
      },
      tracks: [
        {
          id: "trk_blue",
          title: "Blue Highway",
          kind: "audio",
          origin: "uploaded",
          provider: "upload",
          durationSec: 214,
          createdAt: 1780944000000,
          liked: true,
          tags: ["night"],
          media: {
            key: "objects/media/sha256-blue.mp3",
            url: "objects/media/sha256-blue.mp3",
            mime: "audio/mpeg",
            bytes: 8241123,
            sha256: "abc",
          },
          cover: {
            key: "objects/covers/blue.jpg",
            url: "objects/covers/blue.jpg",
            mime: "image/jpeg",
            bytes: 512221,
          },
          memories: [
            {
              id: "mem_1",
              note: "朋友开车去海边那晚",
              author: {
                devicePublicId: "dvc_me",
                displayName: "Mac desktop",
                avatarSeed: "ocean-blue",
              },
              createdAt: 1780944000000,
              atSec: 98,
            },
          ],
        },
      ],
    });

    expect(setIndex.tracks[0]?.memories?.[0]?.author?.devicePublicId).toBe("dvc_me");
    expect(setIndex.tracks[0]?.memories?.[0]?.atSec).toBe(98);
  });

  it("allows streamed source metadata without media but still requires media for local-origin tracks", () => {
    const baseSet = {
      id: "ses_tokyo",
      name: "Tokyo Night Drive",
      seedPrompt: "source playlist",
      displayMode: "cover" as const,
      config: {
        autoExtend: false,
        refillThreshold: 2,
        batchSize: 1,
        targetDurationSec: 60,
        allowVocals: true,
      },
      createdAt: 1780944000000,
      updatedAt: 1780944000000,
    };

    const streamed = r2SetIndexSchema.parse({
      schema: "muzero-r2-set-index-v1",
      set: baseSet,
      tracks: [
        {
          id: "trk_ne",
          title: "Moon Bridge",
          kind: "audio",
          origin: "streamed",
          provider: "netease",
          durationSec: 198,
          createdAt: 1780944000000,
          liked: false,
          tags: [],
          streamSourceId: "netease",
          streamExternalId: "song_42",
          streamMeta: {
            artist: "Aki",
            album: "Rain City",
            coverUrl: "https://p1.music.126.net/cover.jpg",
            durationSec: 198,
          },
          memories: [],
        },
      ],
    });

    expect(streamed.tracks[0]?.media).toBeUndefined();
    expect(streamed.tracks[0]?.streamExternalId).toBe("song_42");
    expect(() =>
      r2SetIndexSchema.parse({
        schema: "muzero-r2-set-index-v1",
        set: baseSet,
        tracks: [
          {
            id: "trk_upload",
            title: "Upload",
            kind: "audio",
            origin: "uploaded",
            provider: "upload",
            durationSec: 10,
            createdAt: 1780944000000,
            liked: false,
            tags: [],
            memories: [],
          },
        ],
      }),
    ).toThrow(/media/);
  });
});

describe("share and stats schemas", () => {
  it("parses a read-only share manifest", () => {
    expect(
      r2ShareManifestSchema.parse({
        schema: "muzero-r2-share-manifest-v1",
        shareId: "shr_tokyo",
        title: "Tokyo",
        createdAt: "2026-06-09T00:00:00.000Z",
        updatedAt: "2026-06-09T00:00:00.000Z",
        baseUrl: "https://music.example.com/muzero/",
        sourceSetId: "ses_tokyo",
        index: "shares/shr_tokyo/index.json",
        capabilities: {
          readMedia: true,
          readMemories: false,
          writeStats: false,
          writePresence: false,
        },
      }).capabilities.writeStats,
    ).toBe(false);
  });

  it("parses per-device stats aggregates", () => {
    expect(
      r2StatsSchema.parse({
        schema: "muzero-r2-stats-v1",
        devicePublicId: "dvc_me",
        revision: 2,
        updatedAt: 1780947600000,
        aggregates: [
          {
            scope: "track",
            trackId: "trk_blue",
            playCount: 3,
            listenedSec: 514,
            updatedAt: 1780947600000,
          },
        ],
      }).aggregates[0]?.playCount,
    ).toBe(3);
  });
});
