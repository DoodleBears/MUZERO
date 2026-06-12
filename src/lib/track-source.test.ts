import { describe, expect, it } from "vitest";
import { describeTrackCoverSource, describeTrackMediaSource } from "./track-source";

describe("describeTrackMediaSource", () => {
  it("classifies local media and cached streamed media", () => {
    expect(describeTrackMediaSource({ blobId: "blb_1", origin: "uploaded" }).kind).toBe(
      "local-file",
    );
    expect(describeTrackMediaSource({ sourcePath: "/music/local-reference.mp3" }).kind).toBe(
      "local-file",
    );
    expect(describeTrackMediaSource({ blobId: "blb_2", origin: "streamed" }).kind).toBe(
      "local-stream-cache",
    );
  });

  it("classifies R2 remote files separately from generic URLs", () => {
    expect(
      describeTrackMediaSource({
        origin: "uploaded",
        remoteMediaUrl: "https://pub.example.com/objects/media/a.mp3",
        cloudSource: { driveId: "drv_1", driveLabel: "Home R2" },
      }),
    ).toMatchObject({ kind: "r2-file", params: { source: "Home R2" }, host: "pub.example.com" });
    expect(
      describeTrackMediaSource({
        origin: "uploaded",
        remoteMediaUrl: "https://cdn.example.com/audio.mp3",
      }),
    ).toMatchObject({ kind: "url", host: "cdn.example.com" });
  });

  it("classifies resolvable streamed tracks", () => {
    expect(
      describeTrackMediaSource({
        origin: "streamed",
        provider: "netease",
        streamSourceId: "netease",
        streamExternalId: "42",
      }),
    ).toMatchObject({ kind: "stream", params: { source: "netease" } });
  });
});

describe("describeTrackCoverSource", () => {
  it("classifies local, R2, URL, and missing covers", () => {
    expect(describeTrackCoverSource({ coverBlobId: "blb_c" }).kind).toBe("local-cover");
    expect(
      describeTrackCoverSource({
        remoteCoverUrl: "https://pub.example.com/objects/covers/c.jpg",
        cloudSource: { driveId: "drv_1" },
      }).kind,
    ).toBe("r2-cover");
    expect(
      describeTrackCoverSource({ remoteCoverUrl: "https://p1.music.126.net/c.jpg" }),
    ).toMatchObject({ kind: "url", host: "p1.music.126.net" });
    expect(describeTrackCoverSource({}).kind).toBe("missing");
  });
});
