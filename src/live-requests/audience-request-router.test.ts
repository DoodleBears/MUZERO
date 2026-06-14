import { describe, expect, it } from "vitest";
import { planAudienceRequestRoute } from "./audience-request-router";
import type { AudienceRequestPlaybackAction } from "./audience-request-schema";

function route(playbackAction: AudienceRequestPlaybackAction = "play-next") {
  return {
    routeMode: "library-search" as const,
    playbackAction,
    onlineFallbackOnLowConfidence: true,
    hasConfiguredOnlineSources: true,
    canUseAiDj: true,
  };
}

describe("audience request router", () => {
  it("defaults confident Search requests to play next", () => {
    const plan = planAudienceRequestRoute({
      ...route(),
      search: { kind: "match", trackId: "trk_1", onlineFallbackRecommended: false },
    });

    expect(plan).toEqual({ kind: "playback", action: "play-next", trackId: "trk_1" });
  });

  it("sends low-confidence local matches to online fallback before AI", () => {
    const plan = planAudienceRequestRoute({
      ...route(),
      routeMode: "hybrid",
      search: { kind: "low-confidence", onlineFallbackRecommended: true },
    });

    expect(plan).toEqual({ kind: "online-search" });
  });

  it("routes unresolved hybrid requests to AI DJ when available", () => {
    const plan = planAudienceRequestRoute({
      ...route(),
      routeMode: "hybrid",
      search: { kind: "no-match", onlineFallbackRecommended: false },
    });

    expect(plan).toEqual({ kind: "ai-dj" });
  });

  it("requires approval for play-now by default", () => {
    const plan = planAudienceRequestRoute({
      ...route("play-now"),
      requireApprovalForPlayNow: true,
      search: { kind: "match", trackId: "trk_1", onlineFallbackRecommended: false },
    });

    expect(plan).toEqual({
      kind: "needs-approval",
      reason: "play-now-requires-approval",
      trackId: "trk_1",
    });
  });
});
