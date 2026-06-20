import { describe, expect, it } from "vitest";
import { buildDownloadPlan } from "./download-plan";
import type { PlayableStream, PlayableVideoTrack } from "./provider";

const video = (codec: PlayableVideoTrack["codec"]): PlayableVideoTrack => ({
  url: "https://cdn/v.m4s",
  mime: "video/mp4",
  codec,
  height: 1080,
});

const audio = (mime: string): PlayableStream => ({ mediaUrl: "https://cdn/a.m4s", mime });

describe("buildDownloadPlan", () => {
  it("AVC video + AAC (audio/mp4) → copy mp4", () => {
    const plan = buildDownloadPlan(video("avc"), audio("audio/mp4"));
    expect(plan.strategy).toEqual({ kind: "copy", container: "mp4" });
    expect(plan.video.codec).toBe("avc");
    expect(plan.audio.mime).toBe("audio/mp4");
  });

  it("AV1 video + Opus (audio/webm) → copy webm", () => {
    expect(buildDownloadPlan(video("av1"), audio("audio/webm")).strategy).toEqual({
      kind: "copy",
      container: "webm",
    });
  });

  it("forces transcode to mp4 when asked and capable", () => {
    const plan = buildDownloadPlan(video("vp9"), audio("audio/webm"), {
      forceContainer: "mp4",
      caps: { webcodecsAvc: true, webcodecsAac: true },
    });
    expect(plan.strategy).toEqual({ kind: "transcode", via: "webcodecs", container: "mp4" });
  });

  it("honors an explicit audioCodec override (bili FLAC is audio/mp4)", () => {
    const plan = buildDownloadPlan(video("avc"), audio("audio/mp4"), { audioCodec: "flac" });
    expect(plan.strategy).toEqual({ kind: "copy", container: "mp4" });
  });
});
