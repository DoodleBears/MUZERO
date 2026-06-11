import { describe, expect, it, vi } from "vitest";
import {
  cacheStreamPlaylistCover,
  cacheStreamPlaylistTrackCovers,
  cacheStreamTrackCover,
} from "./playlist-cover-cache";

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

describe("cacheStreamTrackCover", () => {
  it("stores an image response as the track cover", async () => {
    const storeCover = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValue(coverResponse(new Blob(["jpg"], { type: "image/jpeg" }), "image/jpeg"));

    await expect(
      cacheStreamTrackCover(
        { trackId: "trk_1", coverUrl: "https://img.example.com/t.jpg" },
        { fetcher, storeCover },
      ),
    ).resolves.toBe(true);

    expect(storeCover).toHaveBeenCalledWith({
      trackId: "trk_1",
      blob: expect.any(Blob),
      mime: "image/jpeg",
    });
  });
});

describe("cacheStreamPlaylistTrackCovers", () => {
  it("caches track covers for imported playlist hits", async () => {
    const findTrack = vi
      .fn()
      .mockResolvedValueOnce({ id: "trk_a" })
      .mockResolvedValueOnce({ id: "trk_b", coverBlobId: "blb_existing" })
      .mockResolvedValueOnce(undefined);
    const cacheTrackCover = vi.fn().mockResolvedValue(true);

    await expect(
      cacheStreamPlaylistTrackCovers(
        {
          sessionId: "ses_1",
          hits: [
            {
              source: "netease",
              externalId: "song_a",
              title: "A",
              coverUrl: "https://img.example.com/a.jpg",
            },
            {
              source: "netease",
              externalId: "song_b",
              title: "B",
              coverUrl: "https://img.example.com/b.jpg",
            },
            {
              source: "netease",
              externalId: "song_c",
              title: "C",
              coverUrl: "https://img.example.com/c.jpg",
            },
            {
              source: "netease",
              externalId: "song_d",
              title: "D",
            },
          ],
        },
        { findTrack, cacheTrackCover },
      ),
    ).resolves.toEqual({ attempted: 1, cached: 1, skipped: 3 });

    expect(cacheTrackCover).toHaveBeenCalledWith({
      trackId: "trk_a",
      coverUrl: "https://img.example.com/a.jpg",
    });
  });
});
