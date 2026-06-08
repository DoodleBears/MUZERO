import type { IAudioMetadata } from "music-metadata";
import { describe, expect, it } from "vitest";
import { fallbackUploadMediaMetadata, metadataFromParsedAudio } from "./media-metadata";

describe("metadataFromParsedAudio", () => {
  it("normalizes common tags, format properties, and embedded cover art", async () => {
    const parsed = metadataFromParsedAudio(
      {
        common: {
          album: "Moonstone Beach",
          artist: "Deidian / Luvmac",
          bpm: 126,
          genre: ["Soluna"],
          isrc: ["JP-ABC-26-00001"],
          picture: [
            {
              data: new Uint8Array([1, 2, 3]),
              format: "image/png",
              type: "Cover (front)",
            },
          ],
          title: "Colored Shores",
          track: { no: 4, of: 12 },
          year: 2026,
        },
        format: {
          bitrate: 320000,
          codec: "MPEG 1 Layer 3",
          container: "MPEG",
          duration: 180,
          numberOfChannels: 2,
          sampleRate: 44100,
          tagTypes: ["ID3v2.3"],
          trackInfo: [],
        },
        native: {},
        quality: { warnings: [] },
      } as unknown as IAudioMetadata,
      { name: "04-colored-shores.mp3", type: "audio/mpeg" } as File,
      1,
    );

    expect(parsed.title).toBe("Colored Shores");
    expect(parsed.mediaMetadata).toMatchObject({
      artists: ["Deidian", "Luvmac"],
      bitrate: 320000,
      container: "MPEG",
      genres: ["Soluna"],
      originalExtension: "mp3",
      originalFileName: "04-colored-shores.mp3",
      originalMime: "audio/mpeg",
      parser: "music-metadata",
      sampleRate: 44100,
      trackNo: 4,
      trackOf: 12,
      year: 2026,
    });
    expect(parsed.embeddedCover?.mime).toBe("image/png");
    await expect(parsed.embeddedCover?.blob.arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    );
  });
});

describe("fallbackUploadMediaMetadata", () => {
  it("preserves original file identity when tag parsing is unavailable", () => {
    const metadata = fallbackUploadMediaMetadata(
      { name: "voice memo.m4a", type: "audio/mp4" } as File,
      "voice memo",
      2,
    );

    expect(metadata).toEqual({
      originalExtension: "m4a",
      originalFileName: "voice memo.m4a",
      originalMime: "audio/mp4",
      parser: "manual",
      parsedAt: 2,
      title: "voice memo",
    });
  });
});
