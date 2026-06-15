import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  type BackgroundComposition,
  type BackgroundLayer,
  type CompositionEvent,
  initialComposition,
  reduceComposition,
  topLayer,
} from "@/lib/background-composition";
import type { BackgroundFrame } from "@/lib/background-frame";

/** A resolved, paintable background frame — the spec plus its bound cover URL. */
export interface ControllerFrame extends BackgroundFrame {
  coverUrl: string;
}

type State = BackgroundComposition<ControllerFrame>;
type Event = CompositionEvent<ControllerFrame>;

/**
 * Drives the layer-stack reducer for the ambient background (Background Frame
 * Controller, Phase 3). The caller feeds the *current* frame spec plus its
 * track-bound, ready cover URL (null while a switch is still resolving — e.g.
 * `backgroundCoverUrl`, which already encodes the stale-track / local-cover
 * protocol guards). A new frame is pushed only when that URL resolves for a
 * different track, so the previous frame holds until the new one is ready (no
 * flash) and a stale URL can never pair with the wrong track (no A→B→C bleed).
 *
 * Opacity is NOT animated through React here: the renderer fades each layer with
 * a CSS transition and calls `settleTop()` once the top has faded fully in, which
 * collapses the now-covered layers. So a switch costs one push + one collapse
 * dispatch, never a per-frame re-render.
 */
export function useBackgroundController(input: {
  trackId: string | undefined;
  spec: BackgroundFrame | null;
  /** Track-bound, ready cover URL; null while resolving (controller then holds). */
  coverUrl: string | null;
}): { layers: BackgroundLayer<ControllerFrame>[]; settleTop: () => void } {
  const [state, dispatch] = useReducer(
    reduceComposition as (s: State, e: Event) => State,
    initialComposition<ControllerFrame>(),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  // Read the spec via a ref so the push effect depends only on the real triggers
  // (track + cover URL), not the spec object's identity (which changes per render).
  const specRef = useRef(input.spec);
  specRef.current = input.spec;

  // Push a new frame when a ready, track-bound cover arrives for a new track.
  useEffect(() => {
    const spec = specRef.current;
    if (!input.coverUrl || !input.trackId || !spec) return;
    const top = topLayer(stateRef.current);
    if (top && top.frame.trackId === input.trackId) return;
    dispatch({
      type: "TARGET_CHANGED",
      frame: { ...spec, trackId: input.trackId, coverUrl: input.coverUrl },
    });
    // We only push frames whose cover URL is already resolved/bound, so mark the
    // fresh top ready immediately; the renderer still self-gates its fade on the
    // image decode, so this never causes a flash.
    dispatch({ type: "INCOMING_READY", generation: stateRef.current.generation + 1 });
  }, [input.coverUrl, input.trackId]);

  const settleTop = useCallback(() => dispatch({ type: "ADVANCE", progress: 1 }), []);

  return { layers: state.layers, settleTop };
}
