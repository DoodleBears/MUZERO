import type { IAudioMetadata } from "music-metadata";
import { describe, expect, it } from "vitest";
import {
  fallbackUploadMediaMetadata,
  metadataFromParsedAudio,
  parseUploadedMediaMetadata,
} from "./media-metadata";

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

describe("parseUploadedMediaMetadata", () => {
  it("imports MP3 ID3 title, artist, album, genre, year, and cover art", async () => {
    const parsed = await parseUploadedMediaMetadata(
      id3v23File({
        album: "Soluna Music",
        artist: "Deidian",
        cover: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        genre: "Organic House",
        title: "Moonstone Beach",
        year: "2026",
      }),
    );

    expect(parsed.title).toBe("Moonstone Beach");
    expect(parsed.mediaMetadata).toMatchObject({
      album: "Soluna Music",
      artists: ["Deidian"],
      genres: ["Organic House"],
      originalExtension: "mp3",
      originalFileName: "moonstone-beach.mp3",
      originalMime: "audio/mpeg",
      parser: "music-metadata",
      title: "Moonstone Beach",
      year: 2026,
    });
    expect(parsed.embeddedCover?.mime).toBe("image/jpeg");
    await expect(parsed.embeddedCover?.blob.arrayBuffer()).resolves.toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    );
  });

  it("imports FLAC Vorbis comments and picture metadata", async () => {
    const parsed = await parseUploadedMediaMetadata(
      flacFile({
        album: "Soluna Music",
        artist: "Luvmac",
        cover: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        genre: "Melodic House",
        title: "Amicable",
        year: "2026",
      }),
    );

    expect(parsed.title).toBe("Amicable");
    expect(parsed.mediaMetadata).toMatchObject({
      album: "Soluna Music",
      artists: ["Luvmac"],
      genres: ["Melodic House"],
      originalExtension: "flac",
      originalFileName: "amicable.flac",
      originalMime: "audio/flac",
      parser: "music-metadata",
      title: "Amicable",
      year: 2026,
    });
    expect(parsed.embeddedCover?.mime).toBe("image/jpeg");
    await expect(parsed.embeddedCover?.blob.arrayBuffer()).resolves.toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    );
  });

  it("imports M4A title, artist, album, genre, year, and cover art", async () => {
    const parsed = await parseUploadedMediaMetadata(
      m4aFile({
        album: "Soluna Music",
        artist: "Imperrs",
        cover: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        genre: "Downtempo",
        title: "Colored Shores",
        year: "2026",
      }),
    );

    expect(parsed.title).toBe("Colored Shores");
    expect(parsed.mediaMetadata).toMatchObject({
      album: "Soluna Music",
      artists: ["Imperrs"],
      genres: ["Downtempo"],
      originalExtension: "m4a",
      originalFileName: "colored-shores.m4a",
      originalMime: "audio/mp4",
      parser: "music-metadata",
      title: "Colored Shores",
      year: 2026,
    });
    expect(parsed.embeddedCover?.mime).toBe("image/jpeg");
    await expect(parsed.embeddedCover?.blob.arrayBuffer()).resolves.toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    );
  });
});

function id3v23File(input: {
  album: string;
  artist: string;
  cover: Uint8Array;
  genre: string;
  title: string;
  year: string;
}): File {
  const frames = [
    textFrame("TIT2", input.title),
    textFrame("TPE1", input.artist),
    textFrame("TALB", input.album),
    textFrame("TCON", input.genre),
    textFrame("TYER", input.year),
    pictureFrame(input.cover),
  ];
  const payload = concatBytes(frames);
  const bytes = concatBytes([
    asciiBytes("ID3"),
    new Uint8Array([3, 0, 0]),
    synchsafe(payload.length),
    payload,
  ]);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], "moonstone-beach.mp3", {
    type: "audio/mpeg",
  });
}

function flacFile(input: {
  album: string;
  artist: string;
  cover: Uint8Array;
  genre: string;
  title: string;
  year: string;
}): File {
  const vorbis = vorbisCommentBlock([
    ["TITLE", input.title],
    ["ARTIST", input.artist],
    ["ALBUM", input.album],
    ["GENRE", input.genre],
    ["DATE", input.year],
  ]);
  const picture = flacPictureBlock(input.cover);
  const bytes = concatBytes([
    asciiBytes("fLaC"),
    flacMetadataBlock(0, new Uint8Array(34)),
    flacMetadataBlock(4, vorbis),
    flacMetadataBlock(6, picture, true),
  ]);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new File([buffer], "amicable.flac", { type: "audio/flac" });
}

function m4aFile(input: {
  album: string;
  artist: string;
  cover: Uint8Array;
  genre: string;
  title: string;
  year: string;
}): File {
  const bytes = concatBytes([
    atom(
      "ftyp",
      concatBytes([asciiBytes("M4A "), uint32be(0), asciiBytes("M4A "), asciiBytes("isom")]),
    ),
    atom(
      "moov",
      atom(
        "udta",
        atom(
          "meta",
          concatBytes([
            new Uint8Array([0, 0, 0, 0]),
            handlerAtom(),
            atom(
              "ilst",
              concatBytes([
                ilstTextAtom(new Uint8Array([0xa9, 0x6e, 0x61, 0x6d]), input.title),
                ilstTextAtom(new Uint8Array([0xa9, 0x41, 0x52, 0x54]), input.artist),
                ilstTextAtom(new Uint8Array([0xa9, 0x61, 0x6c, 0x62]), input.album),
                ilstTextAtom(new Uint8Array([0xa9, 0x67, 0x65, 0x6e]), input.genre),
                ilstTextAtom(new Uint8Array([0xa9, 0x64, 0x61, 0x79]), input.year),
                ilstCoverAtom(input.cover),
              ]),
            ),
          ]),
        ),
      ),
    ),
  ]);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new File([buffer], "colored-shores.m4a", { type: "audio/mp4" });
}

function handlerAtom(): Uint8Array {
  return atom(
    "hdlr",
    concatBytes([
      new Uint8Array([0, 0, 0, 0]),
      uint32be(0),
      asciiBytes("mdir"),
      asciiBytes("appl"),
      uint32be(0),
      uint32be(0),
      new Uint8Array([0]),
    ]),
  );
}

function ilstTextAtom(type: Uint8Array, value: string): Uint8Array {
  return atomBytes(type, atom("data", concatBytes([uint32be(1), uint32be(0), asciiBytes(value)])));
}

function ilstCoverAtom(data: Uint8Array): Uint8Array {
  return atom("covr", atom("data", concatBytes([uint32be(13), uint32be(0), data])));
}

function atom(type: string, payload: Uint8Array): Uint8Array {
  return atomBytes(asciiBytes(type), payload);
}

function atomBytes(type: Uint8Array, payload: Uint8Array): Uint8Array {
  return concatBytes([uint32be(payload.byteLength + 8), type, payload]);
}

function vorbisCommentBlock(comments: [string, string][]): Uint8Array {
  const vendor = asciiBytes("MUZERO test");
  return concatBytes([
    uint32le(vendor.byteLength),
    vendor,
    uint32le(comments.length),
    ...comments.map(([key, value]) => {
      const comment = asciiBytes(`${key}=${value}`);
      return concatBytes([uint32le(comment.byteLength), comment]);
    }),
  ]);
}

function flacPictureBlock(data: Uint8Array): Uint8Array {
  const mime = asciiBytes("image/jpeg");
  return concatBytes([
    uint32be(3),
    uint32be(mime.byteLength),
    mime,
    uint32be(0),
    uint32be(1),
    uint32be(1),
    uint32be(24),
    uint32be(0),
    uint32be(data.byteLength),
    data,
  ]);
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

function textFrame(id: string, value: string): Uint8Array {
  const payload = concatBytes([new Uint8Array([0]), asciiBytes(value)]);
  return frame(id, payload);
}

function pictureFrame(data: Uint8Array): Uint8Array {
  return frame(
    "APIC",
    concatBytes([new Uint8Array([0]), asciiBytes("image/jpeg"), new Uint8Array([0, 3, 0]), data]),
  );
}

function frame(id: string, payload: Uint8Array): Uint8Array {
  return concatBytes([asciiBytes(id), uint32be(payload.length), new Uint8Array([0, 0]), payload]);
}

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function uint32be(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function uint32le(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function synchsafe(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f,
  ]);
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
