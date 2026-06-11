import { describe, expect, it } from "vitest";
import {
  isCloudMetadataOnlyStreamTrack,
  recordStreamSkipFailure,
  streamResolveFailureNotificationLevel,
} from "./playback-failure";

describe("stream playback failure UX", () => {
  it("treats cloud metadata-only streamed tracks as a warning", () => {
    const track = {
      origin: "streamed" as const,
      cloudSource: { driveId: "drv_a" },
    };

    expect(isCloudMetadataOnlyStreamTrack(track)).toBe(true);
    expect(streamResolveFailureNotificationLevel(track, false)).toBe("warning");
  });

  it("keeps local streamed resolve failures as errors unless source access is required", () => {
    const localTrack = {
      origin: "streamed" as const,
      blobId: undefined,
      remoteMediaUrl: undefined,
      cloudSource: undefined,
    };

    expect(isCloudMetadataOnlyStreamTrack(localTrack)).toBe(false);
    expect(streamResolveFailureNotificationLevel(localTrack, false)).toBe("error");
    expect(streamResolveFailureNotificationLevel(localTrack, true)).toBe("warning");
  });
});

describe("stream skip run guard", () => {
  it("continues while there are untried queue members", () => {
    const first = recordStreamSkipFailure(new Set(), "trk_a", 3, 30);
    expect(first.firstFailureInRun).toBe(true);
    expect(first.shouldTryNext).toBe(true);

    const second = recordStreamSkipFailure(first.failedTrackIds, "trk_b", 3, 30);
    expect(second.firstFailureInRun).toBe(false);
    expect(second.shouldTryNext).toBe(true);
  });

  it("stops after every queue member failed once", () => {
    const previous = new Set(["trk_a", "trk_b"]);
    const decision = recordStreamSkipFailure(previous, "trk_c", 3, 30);

    expect(decision.failedTrackIds).toEqual(new Set(["trk_a", "trk_b", "trk_c"]));
    expect(decision.shouldTryNext).toBe(false);
  });

  it("keeps a hard cap for very large queues", () => {
    const previous = new Set(Array.from({ length: 29 }, (_, index) => `trk_${index}`));
    expect(recordStreamSkipFailure(previous, "trk_29", 100, 30).shouldTryNext).toBe(false);
  });
});
