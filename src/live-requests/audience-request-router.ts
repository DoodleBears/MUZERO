import type {
  AudienceRequestPlaybackAction,
  AudienceRequestRouteMode,
} from "./audience-request-schema";

export type AudienceRouteSearchSummary =
  | { kind: "match"; trackId: string; onlineFallbackRecommended: boolean }
  | { kind: "low-confidence"; onlineFallbackRecommended: boolean; trackId?: string }
  | { kind: "no-match"; onlineFallbackRecommended: boolean };

export type AudienceRequestRoutePlan =
  | {
      kind: "playback";
      action: Exclude<AudienceRequestPlaybackAction, "manual-review">;
      trackId: string;
    }
  | {
      kind: "needs-approval";
      reason: "manual-review" | "low-confidence" | "play-now-requires-approval";
      trackId?: string;
    }
  | { kind: "online-search" }
  | { kind: "ai-dj" }
  | { kind: "ignored"; reason: "no-match" | "ai-unavailable" };

export interface PlanAudienceRequestRouteInput {
  routeMode: AudienceRequestRouteMode;
  playbackAction: AudienceRequestPlaybackAction;
  search: AudienceRouteSearchSummary;
  onlineFallbackOnLowConfidence?: boolean;
  hasConfiguredOnlineSources?: boolean;
  canUseAiDj?: boolean;
  requireApprovalForPlayNow?: boolean;
}

function canTryOnline(input: PlanAudienceRequestRouteInput): boolean {
  return Boolean(
    input.onlineFallbackOnLowConfidence &&
      input.hasConfiguredOnlineSources &&
      input.search.onlineFallbackRecommended,
  );
}

function planPlayback(
  action: AudienceRequestPlaybackAction,
  trackId: string,
  requireApprovalForPlayNow: boolean,
): AudienceRequestRoutePlan {
  if (action === "manual-review")
    return { kind: "needs-approval", reason: "manual-review", trackId };
  if (action === "play-now" && requireApprovalForPlayNow) {
    return { kind: "needs-approval", reason: "play-now-requires-approval", trackId };
  }
  return { kind: "playback", action, trackId };
}

export function planAudienceRequestRoute(
  input: PlanAudienceRequestRouteInput,
): AudienceRequestRoutePlan {
  if (input.routeMode === "ai-dj") {
    return input.canUseAiDj ? { kind: "ai-dj" } : { kind: "ignored", reason: "ai-unavailable" };
  }

  if (input.search.kind === "match") {
    return planPlayback(
      input.playbackAction,
      input.search.trackId,
      input.requireApprovalForPlayNow ?? false,
    );
  }

  if (canTryOnline(input)) return { kind: "online-search" };

  if (input.routeMode === "hybrid") {
    return input.canUseAiDj
      ? { kind: "ai-dj" }
      : { kind: "needs-approval", reason: "low-confidence" };
  }

  if (input.search.kind === "low-confidence") {
    return { kind: "needs-approval", reason: "low-confidence", trackId: input.search.trackId };
  }

  return { kind: "ignored", reason: "no-match" };
}
