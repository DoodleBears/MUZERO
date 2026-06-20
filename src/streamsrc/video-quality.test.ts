import { describe, expect, it } from "vitest";
import type { VideoQualityOption } from "./provider";
import { sortVideoQualitiesDesc, videoQualityLabel } from "./video-quality";

describe("videoQualityLabel", () => {
  it("labels P-tiers, with an fps suffix only above 30", () => {
    expect(videoQualityLabel(1080)).toBe("1080P");
    expect(videoQualityLabel(1080, 30)).toBe("1080P");
    expect(videoQualityLabel(1080, 60)).toBe("1080P60");
    expect(videoQualityLabel(720, 30)).toBe("720P");
  });

  it("labels 4K/8K and appends HDR", () => {
    expect(videoQualityLabel(2160)).toBe("4K");
    expect(videoQualityLabel(2160, 60, true)).toBe("4K60 HDR");
    expect(videoQualityLabel(4320)).toBe("8K");
  });
});

describe("sortVideoQualitiesDesc", () => {
  it("orders by height, then fps, then HDR — highest first", () => {
    const opts: VideoQualityOption[] = [
      { key: "720", label: "720P", height: 720, codec: "avc" },
      { key: "2160", label: "4K", height: 2160, codec: "av1" },
      { key: "1080", label: "1080P", height: 1080, fps: 30, codec: "avc" },
      { key: "1080-60", label: "1080P60", height: 1080, fps: 60, codec: "avc" },
    ];
    expect(sortVideoQualitiesDesc(opts).map((o) => o.label)).toEqual([
      "4K",
      "1080P60",
      "1080P",
      "720P",
    ]);
  });

  it("does not mutate the input", () => {
    const opts: VideoQualityOption[] = [
      { key: "720", label: "720P", height: 720, codec: "avc" },
      { key: "1080", label: "1080P", height: 1080, codec: "avc" },
    ];
    sortVideoQualitiesDesc(opts);
    expect(opts[0].height).toBe(720);
  });
});
