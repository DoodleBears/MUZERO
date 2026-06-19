import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { usePreloadedCoverUrls } from "./use-preloaded-cover-urls";

const mocks = vi.hoisted(() => ({
  buildCoverPreloadRequests: vi.fn(),
  filterCoverPreloadRequestsForBurst: vi.fn((requests) => requests),
  preloadCoverBatch: vi.fn(),
  releasePreloadedCover: vi.fn(),
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({ coverCropped: true }),
}));

vi.mock("./cover-preload", () => ({
  buildCoverPreloadRequests: mocks.buildCoverPreloadRequests,
  filterCoverPreloadRequestsForBurst: mocks.filterCoverPreloadRequestsForBurst,
  preloadCoverBatch: mocks.preloadCoverBatch,
  releasePreloadedCover: mocks.releasePreloadedCover,
}));

describe("usePreloadedCoverUrls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildCoverPreloadRequests.mockReturnValue([
      {
        coverBlobId: "blb_cover",
        key: "cover-key",
        role: "current",
        trackId: "trk_cover",
      },
    ]);
    mocks.preloadCoverBatch.mockImplementation(async ({ onEntry }) => {
      onEntry?.("trk_cover", "blob:cover");
      return {
        canceled: false,
        entries: {
          trk_cover: {
            cacheKey: "cover-key",
            key: "cover-key",
            url: "blob:cover",
          },
        },
        stats: {},
      };
    });
  });

  it("releases preloaded cover URLs and stops batches while disabled", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        usePreloadedCoverUrls([{ role: "current", track: makeTrack("trk_cover") }], false, enabled),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.trk_cover).toBe("blob:cover"));
    expect(mocks.preloadCoverBatch).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    await waitFor(() => expect(result.current).toEqual({}));
    expect(mocks.releasePreloadedCover).toHaveBeenCalledWith({
      cacheKey: "cover-key",
      key: "cover-key",
      url: "blob:cover",
    });

    mocks.preloadCoverBatch.mockClear();
    rerender({ enabled: false });
    await Promise.resolve();

    expect(mocks.preloadCoverBatch).not.toHaveBeenCalled();
  });

  it("skips preload batches when visibility ends before the settle window", async () => {
    const { rerender } = renderHook(
      ({ enabled }) =>
        usePreloadedCoverUrls([{ role: "current", track: makeTrack("trk_cover") }], false, enabled),
      { initialProps: { enabled: true } },
    );

    expect(mocks.preloadCoverBatch).not.toHaveBeenCalled();

    rerender({ enabled: false });
    await Promise.resolve();

    expect(mocks.preloadCoverBatch).not.toHaveBeenCalled();
  });
});

function makeTrack(id: string): Track {
  return {
    coverBlobId: "blb_cover",
    createdAt: 1,
    durationSec: 30,
    id,
    kind: "audio",
    liked: false,
    origin: "uploaded",
    playCount: 0,
    provider: "upload",
    sessionId: "ses_1",
    status: "ready",
    tags: [],
    title: "Cover Track",
  };
}
