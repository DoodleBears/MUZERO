import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTrackMediaUrl } from "./use-media";

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
