import type { NormalizedAudienceRequest } from "./audience-request-schema";
import type { IntakeCommandMatch } from "./intake-command";

/**
 * Annotation intents for the live-request (弹幕) intake — the non-search commands.
 * `评分` updates the currently-playing track's crowd rating (this file, Phase 2);
 * `评论` writes a Memory (Phase 3). Injected deps keep these deterministically
 * unit-testable and free of store/db imports (hard rule #6/#7).
 */

/**
 * Stable per-rater identity for dedup + attribution. Prefer the normalized
 * `requesterKey` (platform:id); otherwise synthesize from platform + display name.
 * The host's own vote uses the reserved "self" key (never via this path).
 */
export function resolveRaterKey(request: NormalizedAudienceRequest): string {
  if (request.requesterKey) return request.requesterKey;
  const platform = (request.platform ?? "anon").toLowerCase();
  const who = request.requesterDisplayName ?? request.externalId ?? "anon";
  return `audience:${platform}:${who}`;
}

export interface RatingApplyDeps {
  setTrackRating: (trackId: string, raterKey: string, score: number) => Promise<void>;
  getCurrentTrackId: () => string | undefined | Promise<string | undefined>;
  onRated?: (input: { trackId: string; raterKey: string; score: number }) => void;
}

export interface AnnotationApplyResult {
  status: "written" | "ignored";
  reason?: "no-current-track" | "no-score";
}

/**
 * Apply a `评分` command: record the requester's vote (1–5) on the currently-playing
 * track. Silent — never searches or plays. Ignored when the rating carried no score
 * or nothing is playing.
 */
export async function applyRatingCommand(
  match: IntakeCommandMatch,
  request: NormalizedAudienceRequest,
  deps: RatingApplyDeps,
): Promise<AnnotationApplyResult> {
  if (match.score == null) return { status: "ignored", reason: "no-score" };
  const trackId = await deps.getCurrentTrackId();
  if (!trackId) return { status: "ignored", reason: "no-current-track" };
  const raterKey = resolveRaterKey(request);
  await deps.setTrackRating(trackId, raterKey, match.score);
  deps.onRated?.({ trackId, raterKey, score: match.score });
  return { status: "written" };
}
