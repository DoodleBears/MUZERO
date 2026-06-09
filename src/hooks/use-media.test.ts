import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEntityCoverUrl, useTrackMediaUrl } from "./use-media";

describe("useTrackMediaUrl", () => {
  it("returns a remote media URL without creating a Blob object URL", () => {
    const { result } = renderHook(() =>
      useTrackMediaUrl({
        blobId: undefined,
        remoteMediaUrl: "https://music.example.com/muzero/objects/audio.mp3",
      }),
    );

    expect(result.current).toBe("https://music.example.com/muzero/objects/audio.mp3");
  });
});

describe("useEntityCoverUrl", () => {
  it("falls back to the track cover when there is no custom override", () => {
    const { result } = renderHook(() =>
      useEntityCoverUrl(undefined, {
        coverBlobId: undefined,
        coverCrop: undefined,
        remoteCoverUrl: "https://music.example.com/muzero/objects/cover.jpg",
      }),
    );

    expect(result.current).toBe("https://music.example.com/muzero/objects/cover.jpg");
  });

  it("returns null when neither an override nor a fallback cover exists", () => {
    const { result } = renderHook(() => useEntityCoverUrl(undefined, undefined));
    expect(result.current).toBeNull();
  });
});
