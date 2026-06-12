import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import {
  detectStreamSource,
  isStreamedTrack,
  isTrackCacheableToDevice,
  playbackSourceKind,
} from "./source-detect";

function track(partial: Partial<Track>): Track {
  return {
    id: "trk_1",
    sessionId: "ses_1",
    title: "x",
    kind: "audio",
    origin: "generated",
    provider: "mock",
    status: "ready",
    durationSec: 1,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    ...partial,
  };
}

describe("detectStreamSource", () => {
  it("returns the source id for a streamed track", () => {
    expect(detectStreamSource(track({ origin: "streamed", streamSourceId: "bili" }))).toBe("bili");
    expect(detectStreamSource(track({ origin: "streamed", streamSourceId: "netease" }))).toBe(
      "netease",
    );
  });

  it("returns null for generated / uploaded tracks", () => {
    expect(detectStreamSource(track({ origin: "generated" }))).toBeNull();
    expect(detectStreamSource(track({ origin: "uploaded" }))).toBeNull();
  });

  it("returns null for a streamed track missing its source id", () => {
    expect(detectStreamSource(track({ origin: "streamed" }))).toBeNull();
  });
});

describe("isStreamedTrack", () => {
  it("is true only when origin + source id + external id are all present", () => {
    expect(
      isStreamedTrack(
        track({ origin: "streamed", streamSourceId: "bili", streamExternalId: "BV1#123" }),
      ),
    ).toBe(true);
    expect(isStreamedTrack(track({ origin: "streamed", streamSourceId: "bili" }))).toBe(false);
    expect(isStreamedTrack(track({ origin: "generated" }))).toBe(false);
  });
});

describe("playbackSourceKind (local-first priority)", () => {
  const streamed = {
    origin: "streamed" as const,
    streamSourceId: "netease" as const,
    streamExternalId: "33894312",
  };

  it("a DOWNLOADED streamed track plays from its local blob, never re-resolving online", () => {
    // The whole point of offline cache: blobId wins over the stream resolve.
    expect(playbackSourceKind(track({ ...streamed, blobId: "blb_1" }))).toBe("blob");
  });

  it("an un-downloaded streamed track resolves online", () => {
    expect(playbackSourceKind(track({ ...streamed, blobId: undefined }))).toBe("stream");
  });

  it("blob outranks every other source", () => {
    expect(
      playbackSourceKind(
        track({
          ...streamed,
          blobId: "blb_1",
          remoteMediaUrl: "https://cdn/x.mp3",
          sourcePath: "/music/local.mp3",
        }),
      ),
    ).toBe("blob");
    expect(playbackSourceKind(track({ origin: "generated", blobId: "blb_2" }))).toBe("blob");
  });

  it("local-file references outrank remote and stream sources without requiring a blob", () => {
    expect(
      playbackSourceKind(
        track({
          origin: "uploaded",
          sourcePath: "/music/blue.mp3",
          remoteMediaUrl: "https://cdn/x.mp3",
        }),
      ),
    ).toBe("local-file");
    expect(playbackSourceKind(track({ ...streamed, sourcePath: "/music/stream-cache.mp3" }))).toBe(
      "local-file",
    );
  });

  it("falls back remote → stream → none in order", () => {
    expect(
      playbackSourceKind(track({ origin: "uploaded", remoteMediaUrl: "https://cdn/x.mp3" })),
    ).toBe("remote");
    expect(playbackSourceKind(track({ ...streamed }))).toBe("stream");
    expect(playbackSourceKind(track({ origin: "generated" }))).toBe("none");
    // A streamed track missing its external id isn't resolvable → none.
    expect(playbackSourceKind(track({ origin: "streamed", streamSourceId: "netease" }))).toBe(
      "none",
    );
  });
});

describe("isTrackCacheableToDevice", () => {
  const streamed = {
    origin: "streamed" as const,
    streamSourceId: "netease" as const,
    streamExternalId: "33894312",
  };

  it("includes streamed tracks and R2 remote tracks that still lack local blobs", () => {
    expect(isTrackCacheableToDevice(track({ ...streamed }))).toBe(true);
    expect(
      isTrackCacheableToDevice(track({ origin: "uploaded", remoteMediaUrl: "https://cdn/x.mp3" })),
    ).toBe(true);
  });

  it("excludes tracks that are already local, not ready, or have no fetchable source", () => {
    expect(isTrackCacheableToDevice(track({ ...streamed, blobId: "blb_1" }))).toBe(false);
    expect(
      isTrackCacheableToDevice(track({ origin: "uploaded", sourcePath: "/music/a.mp3" })),
    ).toBe(false);
    expect(
      isTrackCacheableToDevice(
        track({ origin: "uploaded", remoteMediaUrl: "https://cdn/x.mp3", status: "pending" }),
      ),
    ).toBe(false);
    expect(isTrackCacheableToDevice(track({ origin: "uploaded" }))).toBe(false);
  });
});
