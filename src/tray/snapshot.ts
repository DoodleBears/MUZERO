import type { SetDisplayMode, Track } from "@/db/types";
import { trackSubtitle } from "@/lib/track-display";
import type { RepeatMode } from "@/player/queue";
import type { TrayLabels, TraySnapshot } from "./menu-model";

export interface TrayPlaybackSnapshotInput {
  labels: TrayLabels;
  currentTrack?: Track;
  liked?: boolean;
  isPlaying: boolean;
  repeat: RepeatMode;
  displayMode: SetDisplayMode;
  /** Intentionally ignored: the tray menu should not update on every progress tick. */
  positionSec?: number;
  /** Intentionally ignored: duration changes should not churn native menu labels. */
  durationSec?: number;
}

export function buildTraySnapshotFromPlayback(input: TrayPlaybackSnapshotInput): TraySnapshot {
  const subtitle = input.currentTrack ? meaningfulSubtitle(input.currentTrack) : undefined;
  const currentTrack = input.currentTrack
    ? {
        id: input.currentTrack.id,
        title: input.currentTrack.title,
        subtitle,
        liked: input.liked ?? input.currentTrack.liked,
      }
    : undefined;

  return {
    labels: input.labels,
    currentTrack,
    isPlaying: input.isPlaying,
    repeat: input.repeat,
    displayMode: input.displayMode,
  };
}

function meaningfulSubtitle(track: Track): string | undefined {
  const subtitle = trackSubtitle(track).trim();
  return subtitle && subtitle !== track.title.trim() ? subtitle : undefined;
}
