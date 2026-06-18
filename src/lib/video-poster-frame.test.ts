import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mediabunnyExtract = vi.hoisted(() => vi.fn());

vi.mock("@/lib/media-mediabunny-frames", () => ({
  extractVideoFramesBatchViaMediabunny: mediabunnyExtract,
}));

import { extractUsefulVideoPosterFrame } from "@/lib/video-poster-frame";

const realCreateElement = document.createElement.bind(document);

function mockNativeVideoFailure() {
  let video: HTMLVideoElement | undefined;
  vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    const element = realCreateElement(tagName, options);
    if (tagName.toLowerCase() === "video") {
      video = element as HTMLVideoElement;
      video.load = vi.fn();
    }
    return element;
  });
  return () => {
    if (!video) throw new Error("Expected poster extraction to create a video element.");
    video.dispatchEvent(new Event("error"));
  };
}

beforeEach(() => {
  mediabunnyExtract.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractUsefulVideoPosterFrame", () => {
  it("falls back to mediabunny when native video frame extraction fails", async () => {
    const fallbackBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
    mediabunnyExtract.mockResolvedValue([
      {
        atTimeSeconds: 0.1,
        blob: new Blob([new Uint8Array([0])], { type: "image/webp" }),
        height: 720,
        mime: "image/webp",
        score: { black: true, lumaMean: 0, lumaVariance: 0, nonBlackRatio: 0, rank: 0 },
        width: 1280,
      },
      {
        atTimeSeconds: 0.5,
        blob: fallbackBlob,
        height: 720,
        mime: "image/webp",
        score: { black: false, lumaMean: 0.4, lumaVariance: 0.1, nonBlackRatio: 0.8, rank: 0.7 },
        width: 1280,
      },
    ]);
    const failNative = mockNativeVideoFailure();
    const file = new File([new Uint8Array([1, 2, 3])], "clip.mkv", {
      type: "video/x-matroska",
    });

    const result = extractUsefulVideoPosterFrame(file, { durationSec: 2 });
    failNative();

    await expect(result).resolves.toMatchObject({
      atTimeSeconds: 0.5,
      blob: fallbackBlob,
      source: "mediabunny",
    });
    expect(mediabunnyExtract).toHaveBeenCalledWith(
      file,
      expect.arrayContaining([
        expect.objectContaining({ atTimeSeconds: 0.1 }),
        expect.objectContaining({ atTimeSeconds: 0.5 }),
      ]),
      { durationSec: 2 },
    );
  });
});
