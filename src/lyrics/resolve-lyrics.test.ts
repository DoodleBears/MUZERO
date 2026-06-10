import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import type { LyricsRecord } from "./provider";
import { resolveTrackLyrics } from "./resolve-lyrics";

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
    playCount: 0,
    liked: false,
    tags: [],
    ...over,
  };
}

function rec(over: Partial<LyricsRecord> = {}): LyricsRecord {
  return { source: "lrclib", instrumental: false, status: "found", ...over };
}

describe("resolveTrackLyrics", () => {
  it("returns synced lines when the record has parseable LRC", () => {
    const r = resolveTrackLyrics(track(), rec({ synced: "[00:01.00]hi\n[00:02.00]bye" }));
    expect(r).toEqual({
      mode: "synced",
      source: "lrclib",
      lines: [
        { timeMs: 1000, text: "hi" },
        { timeMs: 2000, text: "bye" },
      ],
    });
  });

  it("falls back to plain when there is no synced text", () => {
    expect(resolveTrackLyrics(track(), rec({ plain: "just words" }))).toEqual({
      mode: "plain",
      text: "just words",
      source: "lrclib",
    });
  });

  it("falls back to plain when synced is present but unparseable", () => {
    const r = resolveTrackLyrics(track(), rec({ synced: "no timestamps here", plain: "p" }));
    expect(r).toEqual({ mode: "plain", text: "p", source: "lrclib" });
  });

  it("reports instrumental for an instrumental record", () => {
    expect(
      resolveTrackLyrics(track(), rec({ status: "instrumental", instrumental: true })),
    ).toEqual({
      mode: "instrumental",
    });
  });

  it("uses the generated brief lyrics when there is no record", () => {
    const t = track({
      origin: "generated",
      brief: { title: "T", caption: "c", lyrics: "la la", durationSec: 60 } as Track["brief"],
    });
    expect(resolveTrackLyrics(t, undefined)).toEqual({
      mode: "plain",
      text: "la la",
      source: "brief",
    });
  });

  it("returns none for a notFound record with no brief fallback", () => {
    expect(resolveTrackLyrics(track(), rec({ status: "notFound" }))).toEqual({ mode: "none" });
  });

  it("returns none when there is neither a record nor brief lyrics", () => {
    expect(resolveTrackLyrics(track(), undefined)).toEqual({ mode: "none" });
    expect(resolveTrackLyrics(undefined, undefined)).toEqual({ mode: "none" });
  });

  it("prefers a manual record over generated brief lyrics", () => {
    const t = track({
      brief: { title: "T", caption: "c", lyrics: "brief words", durationSec: 60 } as Track["brief"],
    });
    const r = resolveTrackLyrics(t, rec({ source: "manual", plain: "manual words" }));
    expect(r).toEqual({ mode: "plain", text: "manual words", source: "manual" });
  });
});
