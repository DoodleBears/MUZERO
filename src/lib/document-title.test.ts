import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import { DEFAULT_DOCUMENT_TITLE, formatDocumentTitle } from "./document-title";

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

describe("formatDocumentTitle", () => {
  it("joins title · artist · album with the brand suffix", () => {
    expect(
      formatDocumentTitle(
        track({
          title: "Nightfall",
          mediaMetadata: {
            artists: ["Yumi", "Ren"],
            album: "Moonlight Archive",
            parser: "music-metadata",
            parsedAt: 1,
          },
        }),
      ),
    ).toBe("Nightfall · Yumi, Ren · Moonlight Archive | MUZERO");
  });

  it("drops artist and album when absent (generated brief-only track)", () => {
    expect(formatDocumentTitle(track({ title: "Lofi Drift" }))).toBe("Lofi Drift | MUZERO");
  });

  it("keeps title + artist when there is no album", () => {
    expect(
      formatDocumentTitle(
        track({
          title: "Sunrise",
          mediaMetadata: { artists: ["Kai"], parser: "music-metadata", parsedAt: 1 },
        }),
      ),
    ).toBe("Sunrise · Kai | MUZERO");
  });

  it("falls back to streamMeta artist/album for streamed tracks", () => {
    expect(
      formatDocumentTitle(
        track({
          title: "海阔天空",
          origin: "uploaded",
          provider: "stream",
          streamMeta: { artist: "Beyond", album: "乐与怒" },
        }),
      ),
    ).toBe("海阔天空 · Beyond · 乐与怒 | MUZERO");
  });

  it("returns the brand title when nothing is playing", () => {
    expect(formatDocumentTitle(undefined)).toBe(DEFAULT_DOCUMENT_TITLE);
  });
});
