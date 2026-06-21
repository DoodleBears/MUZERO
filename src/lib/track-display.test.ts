import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import {
  resolveStageContent,
  trackHasCover,
  trackIsPlayableVideo,
  trackSubtitle,
} from "./track-display";

function track(partial: Partial<Track>): Track {
  return {
    id: "t",
    sessionId: "s",
    title: "Untitled",
    kind: "audio",
    origin: "generated",
    provider: "mock",
    status: "ready",
    durationSec: 30,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    ...partial,
  };
}

const videoTrack = track({ kind: "video", origin: "uploaded", provider: "upload" });
const audioTrack = track({ kind: "audio" });

describe("resolveStageContent — video-first fallback", () => {
  it("shows the video for a ready video track in video mode", () => {
    expect(
      resolveStageContent({
        track: videoTrack,
        displayMode: "video",
        hasCover: false,
      }),
    ).toBe("video");
  });

  it("falls back video → cover → title", () => {
    // audio track, video mode, has cover → cover
    expect(
      resolveStageContent({
        track: audioTrack,
        displayMode: "video",
        hasCover: true,
      }),
    ).toBe("cover");
    // audio track, video mode, no cover → title
    expect(
      resolveStageContent({
        track: audioTrack,
        displayMode: "video",
        hasCover: false,
      }),
    ).toBe("title");
  });

  it("cover mode never shows video and falls back to title when no cover exists", () => {
    expect(
      resolveStageContent({
        track: videoTrack,
        displayMode: "cover",
        hasCover: true,
      }),
    ).toBe("cover");
    expect(
      resolveStageContent({
        track: videoTrack,
        displayMode: "cover",
        hasCover: false,
      }),
    ).toBe("title");
  });

  it("a not-yet-ready video does not show video", () => {
    const pending = track({ kind: "video", status: "generating" });
    expect(
      resolveStageContent({
        track: pending,
        displayMode: "video",
        hasCover: false,
      }),
    ).toBe("title");
  });
});

describe("trackIsPlayableVideo", () => {
  it("is true only for a ready video track", () => {
    expect(trackIsPlayableVideo(videoTrack)).toBe(true);
  });

  it("is false for audio, a not-ready video, or undefined", () => {
    expect(trackIsPlayableVideo(audioTrack)).toBe(false);
    expect(trackIsPlayableVideo(track({ kind: "video", status: "generating" }))).toBe(false);
    expect(trackIsPlayableVideo(track({ kind: "video", status: "pending" }))).toBe(false);
    expect(trackIsPlayableVideo(track({ kind: "video", status: "failed" }))).toBe(false);
    expect(trackIsPlayableVideo(undefined)).toBe(false);
  });

  it("agrees with resolveStageContent's video branch (single source of truth)", () => {
    // In video mode the stage shows video iff the track is a playable video.
    for (const t of [videoTrack, audioTrack, track({ kind: "video", status: "generating" })]) {
      const isVideo =
        resolveStageContent({ track: t, displayMode: "video", hasCover: false }) === "video";
      expect(isVideo).toBe(trackIsPlayableVideo(t));
    }
  });
});

describe("trackHasCover", () => {
  it("is true for a local cover blob", () => {
    expect(trackHasCover(track({ coverBlobId: "blb_1" }))).toBe(true);
  });

  it("is true for a streamed track whose art is a remote URL (no local blob)", () => {
    expect(
      trackHasCover(
        track({ coverBlobId: undefined, remoteCoverUrl: "https://p1.music.126.net/x" }),
      ),
    ).toBe(true);
  });

  it("is false when the track has neither, or is undefined", () => {
    expect(trackHasCover(track({ coverBlobId: undefined, remoteCoverUrl: undefined }))).toBe(false);
    expect(trackHasCover(undefined)).toBe(false);
  });
});

describe("trackSubtitle", () => {
  it("prefers caption, then media metadata, then note, then the title; empty for no track", () => {
    expect(
      trackSubtitle(track({ brief: { title: "x", caption: "lofi", lyrics: "", durationSec: 30 } })),
    ).toBe("lofi");
    expect(
      trackSubtitle(
        track({
          brief: undefined,
          mediaMetadata: {
            album: "Moonlight Archive",
            artists: ["Yumi"],
            parser: "music-metadata",
            parsedAt: 1,
          },
        }),
      ),
    ).toBe("Yumi - Moonlight Archive");
    expect(trackSubtitle(track({ brief: undefined, note: "gym day" }))).toBe("gym day");
    // No caption/note → falls back to the title (uploads always have one). The
    // empty-track fallback copy is localized at the call site, so undefined → "".
    expect(
      trackSubtitle(
        track({
          brief: undefined,
          note: undefined,
          origin: "uploaded",
          kind: "video",
          title: "My Clip",
        }),
      ),
    ).toBe("My Clip");
    expect(trackSubtitle(undefined)).toBe("");
  });
});
