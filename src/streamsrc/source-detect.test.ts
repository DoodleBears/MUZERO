import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import { detectStreamSource, isStreamedTrack } from "./source-detect";

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
