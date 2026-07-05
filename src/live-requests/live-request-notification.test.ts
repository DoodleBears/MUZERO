import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";

const { notifyInfo, notifySuccess } = vi.hoisted(() => ({
  notifyInfo: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("@/stores/notification-store", () => ({
  notify: { info: notifyInfo, success: notifySuccess },
}));
vi.mock("@/i18n/i18n", () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => `${key}:${opts?.title ?? ""}` },
}));

import {
  formatAudienceRequestQueuePreview,
  notifyAiDjRequestReceived,
  notifyAnnotationAdded,
  notifyAudienceRequestPlayed,
  notifyAudienceRequestQueuePreview,
  notifyRatingAdded,
} from "./live-request-notification";

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

describe("notifyAudienceRequestQueuePreview", () => {
  it("formats up to ten waiting tracks and appends a +N overflow marker", () => {
    const tracks = Array.from({ length: 13 }, (_, index) =>
      fakeTrack({ title: `Song ${index + 1}` }),
    );

    expect(formatAudienceRequestQueuePreview(tracks)).toEqual({
      detail:
        "1. Song 1 · 2. Song 2 · 3. Song 3 · 4. Song 4 · 5. Song 5 · 6. Song 6 · 7. Song 7 · 8. Song 8 · 9. Song 9 · 10. Song 10 · +3",
      remaining: 3,
      total: 13,
    });
  });

  it("fires an 8s info toast for the current request queue", () => {
    notifyInfo.mockClear();

    notifyAudienceRequestQueuePreview([
      fakeTrack({ title: "晴天" }),
      fakeTrack({ title: "七里香" }),
    ]);

    expect(notifyInfo).toHaveBeenCalledWith("liveRequest.queuePreview:", {
      detail: "1. 晴天 · 2. 七里香",
      duration: 8000,
    });
  });

  it("does not toast when there is no waiting queue", () => {
    notifyInfo.mockClear();

    notifyAudienceRequestQueuePreview([]);

    expect(notifyInfo).not.toHaveBeenCalled();
  });
});

describe("notifyAiDjRequestReceived", () => {
  it("fires an 8s success toast with the request body as detail", () => {
    notifySuccess.mockClear();

    notifyAiDjRequestReceived({ normalizedQuery: "来一首暖场 city pop" });

    expect(notifySuccess).toHaveBeenCalledWith("liveRequest.aiDjReceived:", {
      detail: "来一首暖场 city pop",
      duration: 8000,
    });
  });
});

describe("annotation toasts", () => {
  it("fires a rating toast with the updated crowd average", () => {
    notifySuccess.mockClear();

    notifyRatingAdded(fakeTrack(), 5, { average: 4.5, count: 2 });

    expect(notifySuccess).toHaveBeenCalledWith("liveRequest.ratingAdded:晴天", {
      detail: "liveRequest.ratingDetail:",
    });
  });

  it("fires a comment toast with commenter attribution and note detail", () => {
    notifySuccess.mockClear();

    notifyAnnotationAdded(fakeTrack(), {
      author: { displayName: "Alice", kind: "audience", key: "bili:1" },
      note: "3:14 这句绝了",
    } as never);

    expect(notifySuccess).toHaveBeenCalledWith("liveRequest.commentAddedBy:晴天", {
      detail: "3:14 这句绝了",
    });
  });
});
