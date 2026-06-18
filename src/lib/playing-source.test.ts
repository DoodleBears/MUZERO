import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import type { StreamPlaylist } from "@/streamsrc/provider";
import { resolvePlayingSource } from "./playing-source";

function track(id: string): Track {
  return { id, sessionId: "ses_1", title: id } as Track;
}

const playlist: StreamPlaylist = {
  id: "pl_1",
  name: "Daily",
  source: "netease",
  trackCount: 12,
};

describe("resolvePlayingSource", () => {
  it("maps a set queue source to the current track anchor", () => {
    expect(
      resolvePlayingSource({
        activeSessionId: "ses_1",
        currentIndex: 1,
        queue: [track("trk_1"), track("trk_2")],
        queueSource: { kind: "set", setId: "ses_1" },
      }),
    ).toEqual({ kind: "set", id: "ses_1", anchorTrackId: "trk_2" });
  });

  it("maps a system playlist queue source to the current track anchor", () => {
    expect(
      resolvePlayingSource({
        activeSessionId: null,
        currentIndex: 0,
        queue: [track("trk_1")],
        queueSource: { kind: "system-playlist", id: "system:liked" },
      }),
    ).toEqual({ kind: "system-playlist", id: "system:liked", anchorTrackId: "trk_1" });
  });

  it("maps an online playlist queue source to the current track anchor", () => {
    expect(
      resolvePlayingSource({
        activeSessionId: null,
        currentIndex: 0,
        queue: [track("trk_1")],
        queueSource: { kind: "online-playlist", playlist },
      }),
    ).toEqual({ kind: "online-playlist", playlist, anchorTrackId: "trk_1" });
  });

  it("returns null without a source or current track", () => {
    expect(
      resolvePlayingSource({
        activeSessionId: null,
        currentIndex: 0,
        queue: [track("trk_1")],
        queueSource: undefined,
      }),
    ).toBeNull();
    expect(
      resolvePlayingSource({
        activeSessionId: "ses_1",
        currentIndex: -1,
        queue: [track("trk_1")],
        queueSource: { kind: "set", setId: "ses_1" },
      }),
    ).toBeNull();
    expect(
      resolvePlayingSource({
        activeSessionId: "ses_1",
        currentIndex: 0,
        queue: [],
        queueSource: { kind: "set", setId: "ses_1" },
      }),
    ).toBeNull();
  });
});
