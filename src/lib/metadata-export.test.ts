import { describe, expect, it } from "vitest";
import type { MediaBlob, Track } from "@/db/types";
import { parseUploadedMediaMetadata } from "./media-metadata";
import { createTrackExportBlob, UnsupportedMetadataExportError } from "./metadata-export";

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: "trk_1",
    sessionId: "ses_1",
    title: "Moonstone Beach",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 180,
    createdAt: 1,
    playCount: 0,
    liked: false,
    tags: [],
    mediaMetadata: {
      album: "Soluna Music",
      artists: ["Deidian"],
      genres: ["Organic House"],
      parser: "music-metadata",
      parsedAt: 1,
      title: "Moonstone Beach",
      year: 2026,
    },
    ...overrides,
  };
}

function mediaBlob(mime = "audio/mpeg"): MediaBlob {
  return {
    id: "blb_media",
    trackId: "trk_1",
    role: "media",
    mime,
    bytes: 4,
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: mime }),
  };
}

describe("createTrackExportBlob", () => {
  it("returns byte-identical media in original mode", async () => {
    const exported = await createTrackExportBlob({
      media: mediaBlob(),
      mode: "original",
      track: track(),
    });

    await expect(exported.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3, 4]).buffer);
  });

  it("writes MP3 ID3 metadata and cover art in withMetadata mode", async () => {
    const exported = await createTrackExportBlob({
      cover: {
        id: "blb_cover",
        trackId: "trk_1",
        role: "cover",
        mime: "image/jpeg",
        bytes: 4,
        blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
      },
      media: mediaBlob(),
      mode: "withMetadata",
      track: track(),
    });

    const parsed = await parseUploadedMediaMetadata(
      new File([await exported.arrayBuffer()], "moonstone-beach.mp3", { type: "audio/mpeg" }),
    );
    expect(parsed.mediaMetadata).toMatchObject({
      album: "Soluna Music",
      artists: ["Deidian"],
      genres: ["Organic House"],
      title: "Moonstone Beach",
      year: 2026,
    });
    expect(parsed.embeddedCover?.mime).toBe("image/jpeg");
    await expect(parsed.embeddedCover?.blob.arrayBuffer()).resolves.toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    );
  });

  it("writes FLAC Vorbis comments and cover art in withMetadata mode", async () => {
    const exported = await createTrackExportBlob({
      cover: {
        id: "blb_cover",
        trackId: "trk_1",
        role: "cover",
        mime: "image/jpeg",
        bytes: 4,
        blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
      },
      media: {
        ...mediaBlob("audio/flac"),
        blob: new Blob([minimalFlacBytes()], { type: "audio/flac" }),
      },
      mode: "withMetadata",
      track: track(),
    });

    const parsed = await parseUploadedMediaMetadata(
      new File([await exported.arrayBuffer()], "moonstone-beach.flac", { type: "audio/flac" }),
    );
    expect(parsed.mediaMetadata).toMatchObject({
      album: "Soluna Music",
      artists: ["Deidian"],
      genres: ["Organic House"],
      title: "Moonstone Beach",
      year: 2026,
    });
    expect(parsed.embeddedCover?.mime).toBe("image/jpeg");
    await expect(parsed.embeddedCover?.blob.arrayBuffer()).resolves.toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    );
  });

  it("writes M4A ilst metadata and cover art when the atom layout is safe", async () => {
    const exported = await createTrackExportBlob({
      cover: {
        id: "blb_cover",
        trackId: "trk_1",
        role: "cover",
        mime: "image/jpeg",
        bytes: 4,
        blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
      },
      media: {
        ...mediaBlob("audio/mp4"),
        blob: new Blob([minimalM4aBytes()], { type: "audio/mp4" }),
      },
      mode: "withMetadata",
      track: track({ mediaMetadata: { ...track().mediaMetadata!, originalExtension: "m4a" } }),
    });

    const parsed = await parseUploadedMediaMetadata(
      new File([await exported.arrayBuffer()], "moonstone-beach.m4a", { type: "audio/mp4" }),
    );
    expect(parsed.mediaMetadata).toMatchObject({
      album: "Soluna Music",
      artists: ["Deidian"],
      genres: ["Organic House"],
      title: "Moonstone Beach",
      year: 2026,
    });
    expect(parsed.embeddedCover?.mime).toBe("image/jpeg");
    await expect(parsed.embeddedCover?.blob.arrayBuffer()).resolves.toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    );
  });

  it("rejects unsupported containers explicitly", async () => {
    await expect(
      createTrackExportBlob({
        media: mediaBlob("audio/mp4"),
        mode: "withMetadata",
        track: track(),
      }),
    ).rejects.toBeInstanceOf(UnsupportedMetadataExportError);
  });
});

function minimalFlacBytes(): ArrayBuffer {
  const bytes = concatBytes([asciiBytes("fLaC"), flacMetadataBlock(0, new Uint8Array(34), true)]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function minimalM4aBytes(): ArrayBuffer {
  const bytes = concatBytes([
    atom(
      "ftyp",
      concatBytes([asciiBytes("M4A "), uint32be(0), asciiBytes("M4A "), asciiBytes("isom")]),
    ),
    atom("moov", new Uint8Array()),
  ]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function atom(type: string, payload: Uint8Array): Uint8Array {
  return concatBytes([uint32be(payload.byteLength + 8), asciiBytes(type), payload]);
}

function flacMetadataBlock(type: number, payload: Uint8Array, isLast = false): Uint8Array {
  return concatBytes([
    new Uint8Array([(isLast ? 0x80 : 0) | type]),
    new Uint8Array([
      (payload.byteLength >>> 16) & 0xff,
      (payload.byteLength >>> 8) & 0xff,
      payload.byteLength & 0xff,
    ]),
    payload,
  ]);
}

function uint32be(value: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function asciiBytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
