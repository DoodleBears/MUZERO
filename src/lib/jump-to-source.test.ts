import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchJumpTarget } from "./jump-to-source";

const playlist = { id: "p1", name: "Online", source: "netease" as const, trackCount: 3 };

function nav() {
  return {
    openOnlinePlaylist: vi.fn(),
    openSet: vi.fn(),
    openSystemPlaylist: vi.fn(),
  };
}

describe("dispatchJumpTarget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes set targets through openSet with an anchor", () => {
    const actions = nav();
    dispatchJumpTarget({ anchorTrackId: "trk_1", id: "ses_1", kind: "set" }, actions);

    expect(actions.openSet).toHaveBeenCalledWith("ses_1", "trk_1");
  });

  it("routes system playlist targets through openSystemPlaylist with an anchor", () => {
    const actions = nav();
    dispatchJumpTarget(
      { anchorTrackId: "trk_1", id: "system:liked", kind: "system-playlist" },
      actions,
    );

    expect(actions.openSystemPlaylist).toHaveBeenCalledWith("system:liked", "trk_1");
  });

  it("routes online playlist targets through openOnlinePlaylist with an anchor", () => {
    const actions = nav();
    dispatchJumpTarget({ anchorTrackId: "trk_1", kind: "online-playlist", playlist }, actions);

    expect(actions.openOnlinePlaylist).toHaveBeenCalledWith(playlist, "trk_1");
  });
});
