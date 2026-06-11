import { describe, expect, it } from "vitest";
import {
  isCloudMetadataOnlyStreamTrack,
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
