import type { Track } from "@/db/types";

export interface MediaSessionArtworkSource {
  src: string;
  mime?: string;
}

/** Transport actions we wire to hardware media keys / the OS now-playing widget. */
type MediaSessionTransportAction = "play" | "pause" | "previoustrack" | "nexttrack";

export type MediaSessionTransportHandlers = Partial<
  Record<MediaSessionTransportAction, () => void>
>;

interface MediaSessionTarget {
  navigator?: {
    mediaSession?: {
      metadata: unknown | null;
      playbackState?: MediaSessionPlaybackState;
      setActionHandler?: (
        action: MediaSessionTransportAction,
        handler: (() => void) | null,
      ) => void;
    };
  };
  MediaMetadata?: new (init?: MediaMetadataInit) => unknown;
}

const TRANSPORT_ACTIONS: MediaSessionTransportAction[] = [
  "play",
  "pause",
  "previoustrack",
  "nexttrack",
];

export function buildMediaSessionMetadataInit(
  track: Track,
  artwork?: MediaSessionArtworkSource,
): MediaMetadataInit {
  const metadata = track.mediaMetadata;
  const init: MediaMetadataInit = {
    title: metadata?.title || track.title,
  };
  const artist = metadata?.artists?.length
    ? metadata.artists.join(", ")
    : metadata?.albumArtists?.join(", ");
  if (artist) init.artist = artist;
  if (metadata?.album) init.album = metadata.album;
  if (artwork?.src) {
    init.artwork = [
      {
        src: artwork.src,
        type: artwork.mime,
      },
    ];
  }
  return init;
}

export function canSetPlatformMediaSessionMetadata(
  target: MediaSessionTarget = globalThis,
): boolean {
  return !!target.navigator?.mediaSession && typeof target.MediaMetadata === "function";
}

export function setPlatformMediaSessionMetadata(
  track: Track,
  artwork?: MediaSessionArtworkSource,
  target: MediaSessionTarget = globalThis,
): boolean {
  const mediaSession = target.navigator?.mediaSession;
  const MediaMetadataCtor = target.MediaMetadata;
  if (!mediaSession || typeof MediaMetadataCtor !== "function") return false;
  mediaSession.metadata = new MediaMetadataCtor(buildMediaSessionMetadataInit(track, artwork));
  return true;
}

/**
 * Wire hardware media keys (and the OS now-playing widget's buttons) to transport
 * actions. Without registering `previoustrack`/`nexttrack` handlers the OS leaves
 * those keys (F7/F9 on macOS) inert — only play/pause is auto-handled from the
 * playing media element. Unset actions are cleared so stale handlers can't linger.
 */
export function setPlatformMediaSessionActionHandlers(
  handlers: MediaSessionTransportHandlers,
  target: MediaSessionTarget = globalThis,
): boolean {
  const mediaSession = target.navigator?.mediaSession;
  if (!mediaSession || typeof mediaSession.setActionHandler !== "function") return false;
  for (const action of TRANSPORT_ACTIONS) {
    try {
      mediaSession.setActionHandler(action, handlers[action] ?? null);
    } catch {
      // Some browsers reject actions they don't support — skip them, don't throw.
    }
  }
  return true;
}

/** Mirror playback state to the OS widget so its play/pause button stays in sync. */
export function setPlatformMediaSessionPlaybackState(
  state: MediaSessionPlaybackState,
  target: MediaSessionTarget = globalThis,
): boolean {
  const mediaSession = target.navigator?.mediaSession;
  if (!mediaSession) return false;
  mediaSession.playbackState = state;
  return true;
}
