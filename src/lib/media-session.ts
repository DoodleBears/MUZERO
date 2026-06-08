import type { Track } from "@/db/types";

export interface MediaSessionArtworkSource {
  src: string;
  mime?: string;
}

interface MediaSessionTarget {
  navigator?: {
    mediaSession?: {
      metadata: unknown | null;
    };
  };
  MediaMetadata?: new (init?: MediaMetadataInit) => unknown;
}

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
