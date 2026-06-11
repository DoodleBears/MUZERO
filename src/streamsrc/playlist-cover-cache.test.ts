import { describe, expect, it, vi } from "vitest";
import { cacheStreamPlaylistCover } from "./playlist-cover-cache";

function coverResponse(blob: Blob, contentType: string) {
  return {
    ok: true,
    headers: { get: (key: string) => (key.toLowerCase() === "content-type" ? contentType : null) },
    blob: async () => blob,
  } as Response;
}

describe("cacheStreamPlaylistCover", () => {
  it("stores an image response as the session cover", async () => {
    const storeCover = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValue(coverResponse(new Blob(["jpg"], { type: "image/jpeg" }), "image/jpeg"));

    await expect(
      cacheStreamPlaylistCover(
        { sessionId: "ses_1", coverUrl: "https://img.example.com/c.jpg" },
        { fetcher, storeCover },
      ),
    ).resolves.toBe(true);

    expect(storeCover).toHaveBeenCalledWith({
      sessionId: "ses_1",
      blob: expect.any(Blob),
      mime: "image/jpeg",
    });
  });

  it("skips non-image and empty responses", async () => {
    const storeCover = vi.fn();

    await expect(
      cacheStreamPlaylistCover(
        { sessionId: "ses_1", coverUrl: "https://img.example.com/not-image" },
        {
          fetcher: vi
            .fn()
            .mockResolvedValue(
              coverResponse(new Blob(["html"], { type: "text/html" }), "text/html"),
            ),
          storeCover,
        },
      ),
    ).resolves.toBe(false);

    await expect(
      cacheStreamPlaylistCover(
        { sessionId: "ses_1", coverUrl: "https://img.example.com/empty.jpg" },
        {
          fetcher: vi
            .fn()
            .mockResolvedValue(coverResponse(new Blob([], { type: "image/jpeg" }), "image/jpeg")),
          storeCover,
        },
      ),
    ).resolves.toBe(false);

    expect(storeCover).not.toHaveBeenCalled();
  });
});
