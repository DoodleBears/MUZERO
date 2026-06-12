import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";

vi.mock("music-metadata", () => ({
  parseBlob: vi.fn(async () => ({
    common: { title: "Parsed Title", artists: ["A"] },
    format: { duration: 123, container: "MPEG", codec: "MP3" },
  })),
}));

// jsdom never settles `<img>` loads, so embedded-cover palette extraction would
// hang on the object URL. Match the browser failure fallback: no palette.
vi.mock("@/lib/image-palette", () => ({
  extractImagePalette: vi.fn(async () => []),
}));

import { encode163KeyComment, encodeNcm } from "@/lib/ncm-fixture";
import { ingestMediaBytes } from "./ingest-core";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-test-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});
afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("ingestMediaBytes", () => {
  it("creates an uploaded track from bytes with parsed title/duration + sourcePath", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const { trackId } = await ingestMediaBytes(
      {
        setId: "ses_x",
        name: "song.mp3",
        kind: "audio",
        mime: "audio/mpeg",
        sourcePath: "/m/song.mp3",
        bytes,
      },
      db,
    );
    const track = await db.tracks.get(trackId);
    expect(track?.origin).toBe("uploaded");
    expect(track?.title).toBe("Parsed Title");
    expect(track?.durationSec).toBe(123);
    expect(track?.kind).toBe("audio");
    expect(track?.sourcePath).toBe("/m/song.mp3");
    const media = track?.blobId ? await db.mediaBlobs.get(track.blobId) : undefined;
    expect(media?.role).toBe("media");
  });

  it("falls back to the filename title when tag parsing throws", async () => {
    const { parseBlob } = await import("music-metadata");
    vi.mocked(parseBlob).mockRejectedValueOnce(new Error("bad tags"));
    const { trackId } = await ingestMediaBytes(
      {
        setId: "ses_y",
        name: "Mystery Track.flac",
        kind: "audio",
        mime: "audio/flac",
        sourcePath: "/m/x.flac",
        bytes: new Uint8Array([0]).buffer,
      },
      db,
    );
    const track = await db.tracks.get(trackId);
    expect(track?.title).toBe("Mystery Track");
    expect(track?.durationSec).toBe(0);
  });

  it("decrypts a .ncm: plaintext audio blob + container metadata + embedded cover", async () => {
    const ncm = encodeNcm({
      audio: new Uint8Array([10, 20, 30, 40, 50]),
      cover: Uint8Array.from([0xff, 0xd8, 0xff, 0x11, 0x22]), // jpeg magic
      meta: {
        musicName: "网易神曲",
        artist: [["虚拟歌姬", 7]],
        album: "云端专辑",
        albumPic: "https://p3.music.126.net/x/y.jpg",
        format: "flac",
        duration: 188000,
      },
    });
    const result = await ingestMediaBytes(
      { setId: "ses_ncm", name: "song.ncm", kind: "audio", mime: "", bytes: ncm, decode: "ncm" },
      db,
    );

    expect(result.hasCover).toBe(true); // embedded image → no remote fetch needed
    expect(result.albumPicUrl).toBe("https://p3.music.126.net/x/y.jpg");

    const track = await db.tracks.get(result.trackId);
    expect(track?.origin).toBe("uploaded");
    expect(track?.title).toBe("网易神曲"); // container JSON wins over parsed tags
    expect(track?.mediaMetadata?.album).toBe("云端专辑");
    expect(track?.mediaMetadata?.artists).toEqual(["虚拟歌姬"]);
    expect(track?.mediaMetadata?.originalExtension).toBe("ncm");

    const media = track?.blobId ? await db.mediaBlobs.get(track.blobId) : undefined;
    expect(media?.role).toBe("media");
    expect(media?.mime).toBe("audio/flac"); // decoded mime, not the .ncm container
    expect(media?.bytes).toBe(5); // plaintext audio (decoded bytes round-trip covered in ncm-decode.test)

    const cover = track?.coverBlobId ? await db.mediaBlobs.get(track.coverBlobId) : undefined;
    expect(cover?.role).toBe("cover");
    expect(cover?.mime).toBe("image/jpeg");
  });

  it("surfaces the albumPic from a plaintext mp3's NetEase 163-key comment (no .ncm)", async () => {
    const { parseBlob } = await import("music-metadata");
    vi.mocked(parseBlob).mockResolvedValueOnce({
      common: {
        title: "脱壳的歌",
        comment: [{ text: encode163KeyComment({ albumPic: "http://p2/cover.jpg" }) }],
      },
      format: { duration: 200 },
    } as never);
    const result = await ingestMediaBytes(
      {
        setId: "ses_cmt",
        name: "exported.mp3",
        kind: "audio",
        mime: "audio/mpeg",
        sourcePath: "/m/exported.mp3",
        bytes: new Uint8Array([1, 2, 3]).buffer,
      },
      db,
    );
    expect(result.hasCover).toBe(false);
    expect(result.albumPicUrl).toBe("http://p2/cover.jpg");
    const track = await db.tracks.get(result.trackId);
    expect(track?.title).toBe("脱壳的歌");
  });

  it("decrypts a coverless .ncm and reports the remote albumPic for later fetch", async () => {
    const ncm = encodeNcm({
      audio: new Uint8Array([1, 2, 3]),
      meta: { musicName: "无封面", artist: [["独唱", 1]], albumPic: "https://p1/cover.jpg" },
    });
    const result = await ingestMediaBytes(
      { setId: "ses_ncm2", name: "x.ncm", kind: "audio", mime: "", bytes: ncm, decode: "ncm" },
      db,
    );
    expect(result.hasCover).toBe(false);
    expect(result.albumPicUrl).toBe("https://p1/cover.jpg");
    const track = await db.tracks.get(result.trackId);
    expect(track?.coverBlobId).toBeUndefined();
  });
});
