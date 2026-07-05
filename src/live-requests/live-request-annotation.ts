import type { Memory, MemoryAuthorRef } from "@/db/types";
import type { NormalizedAudienceRequest } from "./audience-request-schema";
import { pruneExpiredTimestamps } from "./audience-request-security";
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
  reason?: "no-current-track" | "no-score" | "empty";
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

/** Build a `MemoryAuthorRef` attributing an audience comment to its sender (single "audience:" prefix). */
export function buildAudienceAuthor(request: NormalizedAudienceRequest): MemoryAuthorRef {
  const key =
    request.requesterKey ??
    `${(request.platform ?? "anon").toLowerCase()}:${
      request.requesterDisplayName ?? request.externalId ?? "anon"
    }`;
  return { devicePublicId: `audience:${key}`, displayName: request.requesterDisplayName };
}

export interface CommentApplyDeps {
  addMemory: (input: {
    trackId: string;
    note: string;
    author?: MemoryAuthorRef;
    atSec?: number;
  }) => Promise<Memory>;
  getCurrentTrackId: () => string | undefined | Promise<string | undefined>;
  /** Validate an explicit `mm:ss`; if it exceeds durationSec, drop the anchor but keep the note. */
  getTrackDurationSec?: (trackId: string) => number | undefined | Promise<number | undefined>;
  onAnnotated?: (input: { trackId: string; memory: Memory }) => void;
}

/**
 * Apply a `评论` command: write a Memory (author = sender) onto the currently-playing
 * track. Default floating (carousel); anchors to `atSec` ONLY when the sender wrote an
 * explicit in-range `mm:ss`; an out-of-range timestamp is discarded while the comment
 * remains floating. Livestream latency makes arrival-time anchoring meaningless (PRD Q10).
 * Ignored when the comment is empty or nothing is playing.
 */
export async function applyAnnotationCommand(
  match: IntakeCommandMatch,
  request: NormalizedAudienceRequest,
  deps: CommentApplyDeps,
): Promise<AnnotationApplyResult & { memoryId?: string }> {
  const note = match.body.trim();
  if (!note) return { status: "ignored", reason: "empty" };
  const trackId = await deps.getCurrentTrackId();
  if (!trackId) return { status: "ignored", reason: "no-current-track" };

  let atSec = match.atSec;
  if (atSec != null) {
    atSec = Math.max(0, Math.floor(atSec));
    const duration = await deps.getTrackDurationSec?.(trackId);
    if (duration != null && Number.isFinite(duration)) {
      atSec = atSec <= Math.floor(duration) ? atSec : undefined;
    }
  }

  const memory = await deps.addMemory({
    trackId,
    note,
    author: buildAudienceAuthor(request),
    atSec,
  });
  deps.onAnnotated?.({ trackId, memory });
  return { status: "written", memoryId: memory.id };
}

/**
 * Lightweight per-rater cooldown + per-minute cap for annotation commands (a comment
 * floods a track's Memory timeline; rating is naturally deduped). Stateful; `now` is
 * passed per call for deterministic tests. Mirrors `audience-request-security`.
 */
export function createAnnotationLimiter() {
  const lastByRater = new Map<string, number>();
  let recent: number[] = [];
  return {
    allow(
      raterKey: string,
      opts: { cooldownMs: number; maxPerMinute: number; now: number },
    ): boolean {
      recent = recent.filter((at) => opts.now - at < 60_000);
      // Same sweep as `recent`: expire cooled-down raters so a multi-day live
      // stream can't grow the map unbounded (memory-leak PRD 20260705 L-8).
      pruneExpiredTimestamps(lastByRater, opts.now, opts.cooldownMs);
      if (recent.length >= opts.maxPerMinute) return false;
      const last = lastByRater.get(raterKey);
      if (last != null && opts.now - last < opts.cooldownMs) return false;
      lastByRater.set(raterKey, opts.now);
      recent.push(opts.now);
      return true;
    },
  };
}
