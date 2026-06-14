import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEntityCoverUrl, useTrackMediaUrl } from "./use-media";

vi.mock("@/lib/cover-asset", () => ({
  getOrFetchRemoteCoverAsset: vi.fn(async () => ({
    blob: new Blob(["cover"], { type: "image/jpeg" }),
    mime: "image/jpeg",
    url: "https://music.example.com/muzero/objects/cover.jpg",
  })),
  remoteCoverAssetKey: (url: string) => `remote:${url}`,
}));

beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:entity-cover");
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
  it("falls back to the track cover when there is no custom override", async () => {
    const { result } = renderHook(() =>
      useEntityCoverUrl(undefined, {
        coverBlobId: undefined,
        coverCrop: undefined,
        remoteCoverUrl: "https://music.example.com/muzero/objects/cover.jpg",
      }),
    );

    await waitFor(() => expect(result.current).toBe("blob:entity-cover"));
  });

  it("returns null when neither an override nor a fallback cover exists", () => {
    const { result } = renderHook(() => useEntityCoverUrl(undefined, undefined));
    expect(result.current).toBeNull();
  });
});
