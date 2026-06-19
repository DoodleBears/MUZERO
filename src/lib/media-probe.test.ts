import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fallbackProbe = vi.hoisted(() => vi.fn());

vi.mock("@/workers/media-probe-client", () => ({
  probeMediaFileViaMediabunnyWorker: fallbackProbe,
}));

import { probeMediaFile, UnsupportedMediaError } from "@/lib/media-probe";

const realCreateElement = document.createElement.bind(document);

function mockCreatedVideo() {
  let video: HTMLVideoElement | undefined;
  vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    const element = realCreateElement(tagName, options);
    if (tagName.toLowerCase() === "video") {
      video = element as HTMLVideoElement;
      Object.defineProperty(video, "error", {
        configurable: true,
        value: { code: 4 },
      });
    }
    return element;
  });
  return () => {
    if (!video) throw new Error("Expected probeMediaFile to create a video element.");
    return video;
  };
}

beforeEach(() => {
  fallbackProbe.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:probe");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("probeMediaFile mediabunny fallback", () => {
  it("probes supported video containers in a worker before creating a media element", async () => {
    fallbackProbe.mockResolvedValue({ durationSec: 274.4, mime: "video/mp4" });
    const createSpy = vi.spyOn(document, "createElement");
    const file = new File(["mp4"], "clip.mp4", { type: "video/mp4" });

    await expect(probeMediaFile(file)).resolves.toMatchObject({
      durationSec: 274.4,
      kind: "video",
      mime: "video/mp4",
      probeSource: "mediabunny-worker",
      title: "clip",
    });
    expect(fallbackProbe).toHaveBeenCalledWith(file);
    expect(createSpy).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("imports an MKV when native metadata probing fails but mediabunny can read it", async () => {
    fallbackProbe.mockResolvedValueOnce(null).mockResolvedValueOnce({
      durationSec: 42.5,
      mime: "video/x-matroska",
    });
    const getVideo = mockCreatedVideo();
    const file = new File(["mkv"], "live-show.mkv", { type: "" });

    const result = probeMediaFile(file);
    await waitFor(() => expect(() => getVideo()).not.toThrow());
    getVideo().dispatchEvent(new Event("error"));

    await expect(result).resolves.toMatchObject({
      durationSec: 42.5,
      kind: "video",
      mime: "video/x-matroska",
      probeSource: "mediabunny-worker",
      title: "live show",
    });
    expect(fallbackProbe).toHaveBeenCalledTimes(2);
  });

  it("keeps rejecting unsupported native failures outside the mediabunny registry", async () => {
    const getVideo = mockCreatedVideo();
    const file = new File(["avi"], "old-camera.avi", { type: "video/x-msvideo" });

    const result = probeMediaFile(file);
    getVideo().dispatchEvent(new Event("error"));

    await expect(result).rejects.toBeInstanceOf(UnsupportedMediaError);
    expect(fallbackProbe).not.toHaveBeenCalled();
  });
});
