import { describe, expect, it, vi } from "vitest";
import type { R2Presence } from "./r2-presence";
import { createR2PresenceCoordinator } from "./r2-presence-coordinator";

describe("createR2PresenceCoordinator", () => {
  it("writes presence on track start, pause, resume, stop, and track change", async () => {
    const written: R2Presence[] = [];
    const coordinator = createR2PresenceCoordinator({
      devicePublicId: "dvc_1",
      deviceName: "Studio",
      writePresence: async (presence) => {
        written.push(presence);
      },
      now: vi
        .fn()
        .mockReturnValueOnce(1_000)
        .mockReturnValueOnce(2_000)
        .mockReturnValueOnce(3_000)
        .mockReturnValueOnce(4_000)
        .mockReturnValueOnce(5_000),
    });

    await coordinator.trackStarted({ trackId: "trk_1", setId: "ses_1", positionSec: 4.3 });
    await coordinator.paused({ positionSec: 12.8 });
    await coordinator.resumed({ positionSec: 14 });
    await coordinator.trackChanged({ trackId: "trk_2", setId: "ses_1", positionSec: 0 });
    await coordinator.stopped({ positionSec: 20 });

    expect(written.map((presence) => presence.state)).toEqual([
      "playing",
      "paused",
      "playing",
      "playing",
      "stopped",
    ]);
    expect(written.map((presence) => presence.trackId)).toEqual([
      "trk_1",
      "trk_1",
      "trk_1",
      "trk_2",
      "trk_2",
    ]);
    expect(written[0]).toMatchObject({
      deviceName: "Studio",
      positionSec: 4,
      setId: "ses_1",
    });
  });

  it("does not rewrite unchanged playback heartbeats before the low-frequency interval", async () => {
    const writePresence = vi.fn(async (_presence: R2Presence) => {});
    const coordinator = createR2PresenceCoordinator({
      devicePublicId: "dvc_1",
      writePresence,
      now: vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(30_000),
    });

    await coordinator.trackStarted({ trackId: "trk_1", setId: "ses_1", positionSec: 0 });
    await coordinator.heartbeat({ positionSec: 15 });

    expect(writePresence).toHaveBeenCalledTimes(1);
  });
});
