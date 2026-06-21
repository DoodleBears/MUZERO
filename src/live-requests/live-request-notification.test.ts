import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";

const { notifySuccess } = vi.hoisted(() => ({ notifySuccess: vi.fn() }));

vi.mock("@/stores/notification-store", () => ({ notify: { success: notifySuccess } }));
vi.mock("@/i18n/i18n", () => ({
  default: { t: (key: string, opts?: { title?: string }) => `${key}:${opts?.title ?? ""}` },
}));

import { notifyAudienceRequestPlayed } from "./live-request-notification";

function fakeTrack(over: Partial<Track> = {}): Track {
  return {
    title: "晴天",
    mediaMetadata: { artists: ["Jay Chou"], album: "叶惠美" },
    ...over,
  } as Track;
}

describe("notifyAudienceRequestPlayed", () => {
  it("fires a success toast leading with the title + artist · album detail", () => {
    notifySuccess.mockClear();

    notifyAudienceRequestPlayed(fakeTrack(), "play-now");

    expect(notifySuccess).toHaveBeenCalledWith("liveRequest.playedNow:晴天", {
      detail: "Jay Chou · 叶惠美",
    });
  });

  it("picks an action-specific message key", () => {
    notifySuccess.mockClear();

    notifyAudienceRequestPlayed(fakeTrack(), "append-queue");

    expect(notifySuccess).toHaveBeenCalledWith("liveRequest.playedQueued:晴天", expect.anything());
  });

  it("omits the detail line when the track has no artist or album", () => {
    notifySuccess.mockClear();

    notifyAudienceRequestPlayed(fakeTrack({ mediaMetadata: undefined }), "play-next");

    expect(notifySuccess).toHaveBeenCalledWith("liveRequest.playedNext:晴天", {
      detail: undefined,
    });
  });
});
