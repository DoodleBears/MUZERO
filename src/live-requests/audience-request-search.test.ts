import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import { pickAudienceRequestMatch } from "./audience-request-search";

function track(id: string, title: string, extra: Partial<Track> = {}): Track {
  return {
    id,
    sessionId: "ses_1",
    title,
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 180,
    createdAt: 1,
    playCount: 0,
    liked: false,
    tags: [],
    mediaMetadata: { title, parser: "manual", parsedAt: 1 },
    ...extra,
  };
}

describe("audience request search", () => {
  it("picks a high-confidence local match", () => {
    const result = pickAudienceRequestMatch({
      tracks: [track("trk_1", "晴天"), track("trk_2", "夜曲")],
      query: "晴天",
      threshold: 80,
      margin: 20,
    });

    expect(result.kind).toBe("match");
    if (result.kind !== "match") throw new Error("expected match");
    expect(result.best.track.id).toBe("trk_1");
    expect(result.onlineFallbackRecommended).toBe(false);
  });

  it("marks close top candidates as low confidence", () => {
    const result = pickAudienceRequestMatch({
      tracks: [track("trk_1", "rain"), track("trk_2", "rain live")],
      query: "rain",
      threshold: 80,
      margin: 100,
    });

    expect(result.kind).toBe("low-confidence");
    expect(result.candidates.map((hit) => hit.track.id)).toEqual(["trk_1", "trk_2"]);
  });

  it("recommends online fallback when local score is too low", () => {
    const result = pickAudienceRequestMatch({
      tracks: [track("trk_1", "never say goodbye")],
      query: "nsg",
      threshold: 80,
      margin: 20,
      onlineFallbackOnLowConfidence: true,
      hasConfiguredOnlineSources: true,
    });

    expect(result.kind).toBe("low-confidence");
    expect(result.onlineFallbackRecommended).toBe(true);
  });

  it("can avoid queueing the current track again", () => {
    const result = pickAudienceRequestMatch({
      tracks: [track("trk_1", "晴天"), track("trk_2", "晴天 live")],
      query: "晴天",
      threshold: 80,
      margin: 20,
      avoidCurrentTrackId: "trk_1",
    });

    if (result.kind === "no-match") throw new Error("expected a candidate");
    expect(result.best?.track.id).toBe("trk_2");
  });

  it("can restrict direct library search to song title fields", () => {
    const result = pickAudienceRequestMatch({
      tracks: [
        track("trk_1", "Blue Hour", { note: "Plastic Love memory", tags: ["plastic-love"] }),
        track("trk_2", "Plastic Love"),
      ],
      query: "Plastic Love",
      threshold: 80,
      margin: 20,
      matchFields: "song-title",
    });

    expect(result.kind).toBe("match");
    if (result.kind !== "match") throw new Error("expected match");
    expect(result.best.track.id).toBe("trk_2");
    expect(result.candidates.map((hit) => hit.track.id)).toEqual(["trk_2"]);
  });

  it("does not treat memories or lyrics as title matches in song-title mode", () => {
    const result = pickAudienceRequestMatch({
      tracks: [track("trk_1", "Blue Hour")],
      query: "Plastic Love",
      threshold: 80,
      margin: 20,
      matchFields: "song-title",
      memoryNotesByTrackId: new Map([["trk_1", ["Plastic Love memory"]]]),
      lyricsByTrackId: new Map([
        [
          "trk_1",
          {
            format: "plain",
            instrumental: false,
            plain: "Plastic Love",
            status: "found",
          },
        ],
      ]),
    });

    expect(result.kind).toBe("no-match");
  });
});
