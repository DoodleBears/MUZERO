import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import { resolveStageContent, trackSubtitle } from "./track-display";

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
