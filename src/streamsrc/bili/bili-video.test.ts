import { describe, expect, it } from "vitest";
import { type BiliVideoStream, parseDashVideo, selectVideoByResolution } from "./bili-video";

/**
 * A realistic `/x/player/wbi/playurl` `data.dash.video[]` body (fnval=4048): several
 * resolutions, with the 1080p tier offered in three codecs (AVC / HEVC / AV1) the way
 * Bilibili actually returns it.
 */
const PLAYURL_DATA = {
  dash: {
    video: [
      {
        id: 16,
        baseUrl: "https://cn-gotcha.bilivideo.com/v360-avc.m4s",
        backupUrl: ["https://upos-sz-mirror08c.bilivideo.com/v360-avc.m4s"],
        bandwidth: 300000,
        mimeType: "video/mp4",
        codecs: "avc1.64001e",
        width: 640,
        height: 360,
        frameRate: "30",
      },
      {
        id: 64,
        baseUrl: "https://cn-gotcha.bilivideo.com/v720-avc.m4s",
        backupUrl: [],
        bandwidth: 1200000,
        mimeType: "video/mp4",
        codecs: "avc1.640020",
        width: 1280,
        height: 720,
        frameRate: "30",
      },
      {
        id: 80,
        baseUrl: "https://cn-gotcha.bilivideo.com/v1080-avc.m4s",
        backupUrl: ["https://upos-sz-mirror08c.bilivideo.com/v1080-avc.m4s"],
        bandwidth: 2400000,
        mimeType: "video/mp4",
        codecs: "avc1.640032",
        width: 1920,
        height: 1080,
        frameRate: "30",
      },
      {
        id: 80,
        baseUrl: "https://cn-gotcha.bilivideo.com/v1080-hevc.m4s",
        backupUrl: [],
        bandwidth: 1800000,
        mimeType: "video/mp4",
        codecs: "hev1.1.6.L120.90",
        width: 1920,
        height: 1080,
        frameRate: "30",
      },
      {
        id: 80,
        baseUrl: "https://cn-gotcha.bilivideo.com/v1080-av1.m4s",
        backupUrl: [],
        bandwidth: 1500000,
        mimeType: "video/mp4",
        codecs: "av01.0.08M.08",
        width: 1920,
        height: 1080,
        frameRate: "30",
      },
      {
        id: 120,
        baseUrl: "https://cn-gotcha.bilivideo.com/v4k-av1.m4s",
        backupUrl: [],
        bandwidth: 9000000,
        mimeType: "video/mp4",
        codecs: "av01.0.12M.08",
        width: 3840,
        height: 2160,
        frameRate: "60",
      },
    ],
    // audio present too — parseDashVideo must ignore it
    audio: [{ id: 30280, baseUrl: "https://x/a.m4s", bandwidth: 192000 }],
  },
};

describe("parseDashVideo", () => {
  it("flattens dash.video[] with codec/height/fps classified, ignoring audio", () => {
    const streams = parseDashVideo(PLAYURL_DATA);
    expect(streams).toHaveLength(6);
    const avc1080 = streams.find((s) => s.height === 1080 && s.codec === "avc") as BiliVideoStream;
    expect(avc1080.codecs).toBe("avc1.640032");
    expect(avc1080.bitrateKbps).toBe(2400);
    expect(avc1080.frameRate).toBe(30);
    expect(avc1080.width).toBe(1920);
    expect(streams.find((s) => s.codec === "hevc")?.height).toBe(1080);
    expect(streams.find((s) => s.codec === "av1" && s.height === 2160)?.id).toBe(120);
  });

  it("returns [] when there is no dash video", () => {
    expect(parseDashVideo({})).toEqual([]);
    expect(parseDashVideo({ dash: { video: [] } })).toEqual([]);
    expect(parseDashVideo(null)).toEqual([]);
  });

  it("accepts snake_case base_url / backup_url / frame_rate", () => {
    const streams = parseDashVideo({
      dash: {
        video: [
          {
            id: 80,
            base_url: "https://upos-x/v.m4s",
            backup_url: ["https://cn-gotcha-x/v.m4s"],
            bandwidth: 2000000,
            codecs: "avc1.640032",
            width: 1920,
            height: 1080,
            frame_rate: "59.940",
          },
        ],
      },
    });
    expect(streams[0].urls[0]).toContain("upos"); // CDN priority reused
    expect(streams[0].frameRate).toBe(60); // rounded
  });
});

describe("selectVideoByResolution", () => {
  const streams = parseDashVideo(PLAYURL_DATA);

  it("picks the requested height, AVC-first by default (container-compat)", () => {
    const pick = selectVideoByResolution(streams, { maxHeight: 1080 });
    expect(pick?.height).toBe(1080);
    expect(pick?.codec).toBe("avc"); // default codec preference favors AVC for mp4 copy
  });

  it("honors an explicit codec preference within the chosen height", () => {
    const pick = selectVideoByResolution(streams, {
      maxHeight: 1080,
      codecPreference: ["av1", "hevc", "avc"],
    });
    expect(pick?.height).toBe(1080);
    expect(pick?.codec).toBe("av1");
  });

  it("caps at maxHeight (720 does not return 1080)", () => {
    expect(selectVideoByResolution(streams, { maxHeight: 720 })?.height).toBe(720);
  });

  it("returns the highest available when no cap is given (max quality)", () => {
    expect(selectVideoByResolution(streams, {})?.height).toBe(2160);
  });

  it("upgrades to the lowest available when the cap is below everything", () => {
    expect(selectVideoByResolution(streams, { maxHeight: 144 })?.height).toBe(360);
  });

  it("returns null for an empty list", () => {
    expect(selectVideoByResolution([], { maxHeight: 1080 })).toBeNull();
  });
});
