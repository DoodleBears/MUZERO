import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import { describeTrackSwitch } from "./switch-trace";

function track(over: Partial<Track> = {}): Track {
  return {
    id: "trk_1",
    sessionId: "ses_1",
    title: "Song",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 100,
    createdAt: 0,
    updatedAt: 0,
    generatedAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    ...over,
  } as Track;
}

describe("describeTrackSwitch", () => {
  it("captures the switch facts that explain a frame drop (index, source, hasCover)", () => {
    const payload = describeTrackSwitch({
      from: 4571,
      to: 4572,
      track: track({ id: "trk_a", coverBlobId: "blb_1" }),
      sourceKind: "blob",
    });
    expect(payload).toEqual({
      from: 4571,
      to: 4572,
      trackId: "trk_a",
      kind: "audio",
      origin: "uploaded",
      sourceKind: "blob",
      hasCover: true,
    });
  });

  it("reports hasCover for a streamed track that only has a remote cover URL", () => {
    const payload = describeTrackSwitch({
      from: 0,
      to: 1,
      track: track({
        coverBlobId: undefined,
        remoteCoverUrl: "https://cdn/c.jpg",
        origin: "generated",
      }),
      sourceKind: "remote",
    });
    expect(payload.hasCover).toBe(true);
    expect(payload.origin).toBe("generated");
  });

  it("reports a coverless track as the cheap switch (no decode to blame)", () => {
    const payload = describeTrackSwitch({
      from: 1,
      to: 2,
      track: track({ coverBlobId: undefined, remoteCoverUrl: undefined }),
      sourceKind: "blob",
    });
    expect(payload.hasCover).toBe(false);
  });

  it("handles an out-of-range / empty selection (no track)", () => {
    const payload = describeTrackSwitch({ from: 0, to: -1, track: undefined, sourceKind: "none" });
    expect(payload).toEqual({
      from: 0,
      to: -1,
      trackId: null,
      kind: null,
      origin: null,
      sourceKind: "none",
      hasCover: false,
    });
  });
});
