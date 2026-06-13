import type { Track } from "@/db/types";
import { trackHasCover } from "@/lib/track-display";

/**
 * The facts about one track switch that explain its cost in a perf trace. A
 * cover-bearing switch (`hasCover: true`) is the one that runs the full cover
 * decode/upload pipeline and tanks FPS; a coverless one is the cheap baseline.
 * `sourceKind` (blob / local-file / remote / stream) tells whether the audio
 * load also did network/IPC work. Emitted once per switch from the player store
 * so a captured trace reads as a switch-by-switch narrative.
 */
export interface SwitchTracePayload {
  from: number;
  to: number;
  trackId: string | null;
  kind: Track["kind"] | null;
  origin: Track["origin"] | null;
  sourceKind: string;
  hasCover: boolean;
}

export function describeTrackSwitch(input: {
  from: number;
  to: number;
  track: Track | undefined;
  sourceKind: string;
}): SwitchTracePayload {
  const { from, to, track, sourceKind } = input;
  return {
    from,
    to,
    trackId: track?.id ?? null,
    kind: track?.kind ?? null,
    origin: track?.origin ?? null,
    sourceKind,
    hasCover: trackHasCover(track),
  };
}
