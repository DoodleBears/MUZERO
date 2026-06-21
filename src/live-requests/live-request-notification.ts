import type { Track } from "@/db/types";
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
