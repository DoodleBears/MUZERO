import { describe, expect, it } from "vitest";
import { decodeNcm, decodeNcmMetadata, isNcmFile, parse163KeyComment } from "@/lib/ncm-decode";
import { encodeNcm } from "@/lib/ncm-fixture";

// A real "163 key(Don't modify):" block (pre-XOR), captured from an actual .ncm.
// Validates the metadata path (XOR 0x63 → base64 → AES-128-ECB → JSON) against a
// real-world sample, independent of the fixture's own AES round-trip.
const REAL_163_KEY =
  "163 key(Don't modify):L64FU3W4YxX3ZFTmbZ+8/UgT7Ohyf7JJlpf3qaePP1pLN7h/xSNfP7reFfFHoYDwsoZBvfUDtleeJ/R0q3R22tQBjhwyIQRpMO5YjWRELBcAnxa3ab5XBkMBljnLeWoGaSj5qUPKwwn/4LKzcu7710ILJD5EXGZJSL03+ojpqj8BVEkW4J2fghdD2oUWAGrDj5fDqZ/OJxWeEK3cwMV0GRHBFkVMVS5hF2rqJ0w+E4x8E85WmYheXIC06cSoakiv2+kL7Fe9XP1mYmfFsUjXbROV3Wedwr+luRvzOd9wEi/giQ4UTVvAs6XYx4gq7LQPYKzkkd3uP6//l1JJxsPVXlridpikRHtRLZtAUaaVpZ+u7LDPBCpLacjREccNlEGxMWyYULdZIDkbieT0djVji6jIzssXoBJliftoFk2SF5IHK8D69QoeWA9QDgzkKJUqlZSG0yyrQZFegnQK3bHUHPq/YB+4YIZTAcFO/n0El5U56W05uPXeMGJV9jGYIMOraMsHGJ60nwHO0Ah8eL21rZBYPWS0A1dJOJNyOYsgQhv/C0MizWxwvfeisF2fy1eJReVYXfHP7/NjKxp4wMaeP9LPzlyZrjARw5Gog3R5+CQ=";

describe("isNcmFile", () => {
  it("matches .ncm (case-insensitive), nothing else", () => {
    expect(isNcmFile("song.ncm")).toBe(true);
    expect(isNcmFile("SONG.NCM")).toBe(true);
    expect(isNcmFile("song.mp3")).toBe(false);
    expect(isNcmFile("song.qmcflac")).toBe(false);
    expect(isNcmFile("ncm")).toBe(false);
  });
});

describe("decodeNcm", () => {
  it("round-trips audio + metadata + embedded cover", () => {
    const audio = new Uint8Array(5000);
    for (let i = 0; i < audio.length; i += 1) audio[i] = (i * 31 + 7) & 0xff;
    // PNG magic so the cover mime is sniffed as image/png.
    const cover = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 9, 9]);

    const ncm = encodeNcm({
      audio,
      cover,
      meta: {
        musicName: "Test Song",
        artist: [
          ["Alice", 1],
          ["Bob", 2],
        ],
        album: "Test Album",
        albumPic: "https://p1.music.126.net/abc/123.jpg",
        format: "flac",
        duration: 211000,
        bitrate: 999000,
      },
    });

    const out = decodeNcm(ncm);
    expect(Array.from(out.audio)).toEqual(Array.from(audio));
    expect(out.audioMime).toBe("audio/flac");
    expect(out.meta.musicName).toBe("Test Song");
    expect(out.meta.artists).toEqual(["Alice", "Bob"]);
    expect(out.meta.album).toBe("Test Album");
    expect(out.meta.albumPicUrl).toBe("https://p1.music.126.net/abc/123.jpg");
    expect(out.meta.durationMs).toBe(211000);
    expect(out.cover?.mime).toBe("image/png");
    expect(Array.from(out.cover?.bytes ?? [])).toEqual(Array.from(cover));
  });

  it("starts audio after the full reserved image space, not just the image size", () => {
    // Real .ncm files reserve image space the audio must skip past (imageSpace >
    // imageSize). Advancing by imageSize alone lands mid-padding → garbage audio.
    const audio = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x11, 0x22, 0x33]); // "ID3"
    const out = decodeNcm(
      encodeNcm({
        audio,
        cover: Uint8Array.from([0xff, 0xd8, 0xff, 0x01]), // imageSize = 4
        coverPadding: 5000, // imageSpace = 5004 → 5000-byte gap before audio
        meta: { musicName: "Padded", artist: [["A", 1]], format: "mp3" },
      }),
    );
    expect(Array.from(out.audio)).toEqual(Array.from(audio));
    expect(out.cover?.mime).toBe("image/jpeg");
    expect(Array.from(out.cover?.bytes ?? [])).toEqual([0xff, 0xd8, 0xff, 0x01]);
  });

  it("decodes with no embedded cover (remote albumPic only)", () => {
    const ncm = encodeNcm({
      audio: Uint8Array.from([1, 2, 3, 4]),
      meta: { musicName: "Coverless", artist: [["Solo", 5]], albumPic: "https://x/y.jpg" },
    });
    const out = decodeNcm(ncm);
    expect(out.cover).toBeUndefined();
    expect(out.meta.albumPicUrl).toBe("https://x/y.jpg");
    expect(out.audioMime).toBe("audio/mpeg"); // no format → default mp3
  });

  it("parses a real-world 163-key metadata block (CJK/Vietnamese title intact)", () => {
    const out = decodeNcm(encodeNcm({ audio: new Uint8Array(0), rawMetaReadable: REAL_163_KEY }));
    expect(out.meta.musicName).toBe("Ai Đưa Em Về （低皮质醇小曲）");
    expect(out.meta.album).toBe("皮质醇小曲");
    expect(out.meta.artists).toEqual(["virtua! girl"]);
    expect(out.meta.albumPicUrl).toBe(
      "http://p3.music.126.net/QCXuWpR3txVTXrIRvFn5TA==/109951173198577241.jpg",
    );
    expect(out.meta.format).toBe("mp3");
  });

  it("throws on a non-ncm header", () => {
    expect(() => decodeNcm(new Uint8Array(64))).toThrow(/ncm/i);
  });
});

describe("decodeNcmMetadata", () => {
  it("parses metadata and cover without returning decoded audio", () => {
    const ncm = encodeNcm({
      audio: Uint8Array.from([1, 2, 3, 4, 5]),
      cover: Uint8Array.from([0xff, 0xd8, 0xff, 0x01]),
      meta: {
        musicName: "Metadata Only",
        artist: [["Artist", 1]],
        album: "Album",
        format: "mp3",
        duration: 123000,
      },
    });

    const out = decodeNcmMetadata(ncm);

    expect("audio" in out).toBe(false);
    expect(out.audioMime).toBe("audio/mpeg");
    expect(out.meta.musicName).toBe("Metadata Only");
    expect(out.meta.artists).toEqual(["Artist"]);
    expect(out.meta.durationMs).toBe(123000);
    expect(out.cover?.mime).toBe("image/jpeg");
    expect(Array.from(out.cover?.bytes ?? [])).toEqual([0xff, 0xd8, 0xff, 0x01]);
  });
});

describe("parse163KeyComment", () => {
  it("decodes a real 163-key comment string (as found in an exported mp3's ID3 comment)", () => {
    const meta = parse163KeyComment(REAL_163_KEY);
    expect(meta?.musicName).toBe("Ai Đưa Em Về （低皮质醇小曲）");
    expect(meta?.album).toBe("皮质醇小曲");
    expect(meta?.artists).toEqual(["virtua! girl"]);
    expect(meta?.albumPicUrl).toBe(
      "http://p3.music.126.net/QCXuWpR3txVTXrIRvFn5TA==/109951173198577241.jpg",
    );
  });

  it("tolerates leading/embedded whitespace from wrapped ID3 readers", () => {
    const wrapped = REAL_163_KEY.replace(/(.{40})/g, "$1\n"); // inject newlines into the base64
    expect(parse163KeyComment(`  ${wrapped}`)?.albumPicUrl).toBe(
      "http://p3.music.126.net/QCXuWpR3txVTXrIRvFn5TA==/109951173198577241.jpg",
    );
  });

  it("returns null for an ordinary comment or garbage", () => {
    expect(parse163KeyComment("just a normal comment")).toBeNull();
    expect(parse163KeyComment("")).toBeNull();
    expect(parse163KeyComment("163 key(Don't modify):not-valid-base64!!")).toBeNull();
  });
});
