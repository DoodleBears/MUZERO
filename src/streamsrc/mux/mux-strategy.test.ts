import { describe, expect, it } from "vitest";
import { chooseMuxStrategy, classifyAudioCodec } from "./mux-strategy";

describe("classifyAudioCodec", () => {
  it("classifies by mime", () => {
    expect(classifyAudioCodec("audio/mp4")).toBe("aac");
    expect(classifyAudioCodec("audio/webm")).toBe("opus");
    expect(classifyAudioCodec("audio/mpeg")).toBe("mp3");
    expect(classifyAudioCodec(undefined)).toBe("other");
  });

  it("refines with the codecs string when given (bili flac/dolby are audio/mp4)", () => {
    expect(classifyAudioCodec("audio/mp4", "fLaC")).toBe("flac");
    expect(classifyAudioCodec("audio/mp4", "ec-3")).toBe("ac3");
    expect(classifyAudioCodec("audio/mp4", "mp4a.40.2")).toBe("aac");
  });
});

describe("chooseMuxStrategy — default (no force): always copy", () => {
  it("AVC/HEVC + AAC → copy mp4", () => {
    expect(chooseMuxStrategy("avc", "aac")).toEqual({ kind: "copy", container: "mp4" });
    expect(chooseMuxStrategy("hevc", "aac")).toEqual({ kind: "copy", container: "mp4" });
  });

  it("VP9/AV1 + Opus → copy webm", () => {
    expect(chooseMuxStrategy("vp9", "opus")).toEqual({ kind: "copy", container: "webm" });
    expect(chooseMuxStrategy("av1", "opus")).toEqual({ kind: "copy", container: "webm" });
  });

  it("AV1 + AAC → copy mp4 (AV1 fits both; AAC pins it to mp4)", () => {
    expect(chooseMuxStrategy("av1", "aac")).toEqual({ kind: "copy", container: "mp4" });
  });

  it("AVC + FLAC/AC-3 → copy mp4 (mp4 holds FLAC/AC-3)", () => {
    expect(chooseMuxStrategy("avc", "flac")).toEqual({ kind: "copy", container: "mp4" });
    expect(chooseMuxStrategy("avc", "ac3")).toEqual({ kind: "copy", container: "mp4" });
  });

  it("mismatched pairs (AVC+Opus / VP9+AAC) → lossless copy to mkv (archive)", () => {
    expect(chooseMuxStrategy("avc", "opus")).toEqual({ kind: "copy", container: "mkv" });
    expect(chooseMuxStrategy("vp9", "aac")).toEqual({ kind: "copy", container: "mkv" });
  });
});

describe("chooseMuxStrategy — force mp4 (opt-in transcode, no bundled ffmpeg)", () => {
  it("already mp4-copyable → copy mp4 (no transcode)", () => {
    expect(chooseMuxStrategy("avc", "aac", { forceContainer: "mp4" })).toEqual({
      kind: "copy",
      container: "mp4",
    });
  });

  it("VP9+Opus with WebCodecs encoders → transcode via webcodecs", () => {
    expect(
      chooseMuxStrategy("vp9", "opus", {
        forceContainer: "mp4",
        caps: { webcodecsAvc: true, webcodecsAac: true },
      }),
    ).toEqual({ kind: "transcode", via: "webcodecs", container: "mp4" });
  });

  it("VP9+Opus with only system ffmpeg → transcode via system-ffmpeg", () => {
    expect(
      chooseMuxStrategy("vp9", "opus", { forceContainer: "mp4", caps: { systemFfmpeg: true } }),
    ).toEqual({ kind: "transcode", via: "system-ffmpeg", container: "mp4" });
  });

  it("AVC+Opus needs only an AAC encoder → webcodecs when AAC-capable", () => {
    expect(
      chooseMuxStrategy("avc", "opus", { forceContainer: "mp4", caps: { webcodecsAac: true } }),
    ).toEqual({ kind: "transcode", via: "webcodecs", container: "mp4" });
  });

  it("no transcode capability at all → unsupported (caller offers webm/install ffmpeg)", () => {
    const s = chooseMuxStrategy("vp9", "opus", { forceContainer: "mp4" });
    expect(s.kind).toBe("unsupported");
  });
});
