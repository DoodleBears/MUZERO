import type { Memory, Track } from "@/db/types";
import i18n from "@/i18n/i18n";
import { trackAlbum, trackArtists } from "@/lib/track-display";
import { notify } from "@/stores/notification-store";
import type { AudienceRequestPlaybackAction } from "./audience-request-schema";

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
