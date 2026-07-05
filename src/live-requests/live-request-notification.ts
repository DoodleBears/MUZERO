import type { Memory, Track } from "@/db/types";
import i18n from "@/i18n/i18n";
import { trackAlbum, trackArtists } from "@/lib/track-display";
import { notify } from "@/stores/notification-store";
import type {
  AudienceRequestPlaybackAction,
  NormalizedAudienceRequest,
} from "./audience-request-schema";
import type { VideoRequestRejectReason } from "./video-request";

/** Which message key confirms the request, given how the track was routed.
 *  `as const` keeps the values as literal i18n keys (not widened to `string`)
 *  so the type-safe `t()` accepts them. */
const MESSAGE_KEY_BY_ACTION = {
  "play-now": "liveRequest.playedNow",
  "play-next": "liveRequest.playedNext",
  "append-queue": "liveRequest.playedQueued",
  // manual-review never reaches playback (it routes to needs-approval); keep a
  // safe default so the map stays exhaustive.
  "manual-review": "liveRequest.playedQueued",
} as const satisfies Record<AudienceRequestPlaybackAction, string>;

const REQUEST_QUEUE_PREVIEW_LIMIT = 10;

export function formatAudienceRequestQueuePreview(
  tracks: Array<Pick<Track, "title">>,
  limit = REQUEST_QUEUE_PREVIEW_LIMIT,
): { detail: string; remaining: number; total: number } | null {
  if (tracks.length === 0) return null;
  const shown = tracks.slice(0, limit);
  const remaining = Math.max(0, tracks.length - shown.length);
  const detail = [
    shown.map((track, index) => `${index + 1}. ${track.title}`).join(" · "),
    remaining > 0 ? `+${remaining}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return { detail, remaining, total: tracks.length };
}

/**
 * Top-left success toast confirming a live song request landed: leads with the
 * matched track's title (action-aware copy) and shows artist · album beneath.
 *
 * Lives outside the runtime on purpose — the controller singleton wires it in
 * via `onRequestPlayed`, so runtime unit tests stay notification-free and the
 * `notify` UI dependency never leaks into the search/route engine.
 */
export function notifyAudienceRequestPlayed(
  track: Track,
  action: AudienceRequestPlaybackAction,
): void {
  const artists = trackArtists(track).join(", ");
  const album = trackAlbum(track);
  const detail = [artists, album].filter(Boolean).join(" · ") || undefined;
  notify.success(i18n.t(MESSAGE_KEY_BY_ACTION[action], { title: track.title }), { detail });
}

export function notifyAudienceRequestQueuePreview(tracks: Track[]): void {
  const preview = formatAudienceRequestQueuePreview(tracks);
  if (!preview) return;
  notify.info(i18n.t("liveRequest.queuePreview", { count: preview.total }), {
    detail: preview.detail,
    duration: 8000,
  });
}

/**
 * Top-left toast confirming a `评分` vote landed: the track + the new star and the
 * updated crowd average · vote count. Same UI-dependency isolation as
 * {@link notifyAudienceRequestPlayed} — wired in by the controller singleton.
 */
export function notifyRatingAdded(
  track: Track,
  score: number,
  rating: { average: number; count: number } | null,
): void {
  const detail = rating
    ? i18n.t("liveRequest.ratingDetail", {
        average: rating.average.toFixed(1),
        count: rating.count,
      })
    : undefined;
  notify.success(i18n.t("liveRequest.ratingAdded", { title: track.title, score }), { detail });
}

/**
 * Top-left toast confirming a `评论` memory landed: who commented on which track,
 * with the note as detail. Same UI-dependency isolation as the other notifiers.
 */
export function notifyAnnotationAdded(track: Track, memory: Memory): void {
  const who = memory.author?.displayName;
  const message = who
    ? i18n.t("liveRequest.commentAddedBy", { name: who, title: track.title })
    : i18n.t("liveRequest.commentAdded", { title: track.title });
  notify.success(message, { detail: memory.note });
}

/**
 * Top-left toast confirming an AI DJ live request was accepted into the DJ queue.
 * This fires on receipt/queueing, not after the model finishes, so the host gets
 * immediate feedback that the audience request landed.
 */
export function notifyAiDjRequestReceived(
  request: Pick<NormalizedAudienceRequest, "normalizedQuery">,
): void {
  notify.success(i18n.t("liveRequest.aiDjReceived"), {
    detail: request.normalizedQuery,
    duration: 8000,
  });
}

export function notifyVideoRequestRejected(input: {
  reason: VideoRequestRejectReason | "download-failed";
  durationSec?: number;
  maxSec?: number;
  message?: string;
}): void {
  if (input.reason === "too-long") {
    notify.error(
      i18n.t("liveRequest.videoTooLong", {
        minutes: Math.ceil((input.maxSec ?? 0) / 60),
      }),
    );
    return;
  }
  if (input.reason === "download-failed") {
    notify.error(i18n.t("liveRequest.videoDownloadFailed"), { detail: input.message });
    return;
  }
  const key = {
    "not-a-video-ref": "liveRequest.videoNotARef",
    "unsupported-source": "liveRequest.videoUnsupportedSource",
    unresolved: "liveRequest.videoUnresolved",
  } as const satisfies Record<Exclude<VideoRequestRejectReason, "too-long">, string>;
  notify.error(i18n.t(key[input.reason]));
}
