/**
 * Layer-stack reducer for the Background Frame Controller (PRD §2.2, Phase 1).
 *
 * The background is a stack of layers, bottom→top in paint order. A switch pushes
 * a new top layer that fades in; switching again mid-fade FREEZES the current top
 * and pushes another over it (the 3-layer carry-over — no rebound, no pop). A
 * layer fully covered by an opaque upper layer is pruned; once the top reaches
 * full opacity everything below collapses away. Generation guards ensure only the
 * latest target can ever advance (no stale cover), and a not-ready top holds (its
 * opacity can't advance) so the base is never swapped to a blank frame (no flash).
 *
 * Pure / generic over the frame type — unit-tested. The controller instantiates
 * it with the resolved `BackgroundFrame`; the reducer only keys on `trackId` +
 * generation.
 */

export interface FrameLike {
  trackId: string;
}

export interface BackgroundLayer<F extends FrameLike> {
  frame: F;
  generation: number;
  /** 0..1. The bottom layer is effectively the base; upper layers fade in. */
  opacity: number;
  /** Passed the ready-gate (§2.3) — only then may its opacity advance. */
  ready: boolean;
}

export interface BackgroundComposition<F extends FrameLike> {
  layers: BackgroundLayer<F>[];
  generation: number;
}

export type CompositionEvent<F extends FrameLike> =
  | { type: "TARGET_CHANGED"; frame: F }
  | { type: "INCOMING_READY"; generation: number }
  | { type: "ADVANCE"; progress: number };

/** Backstop against runaway stacks under pathological rapid switching. */
export const MAX_BACKGROUND_LAYERS = 4;

export function initialComposition<F extends FrameLike>(): BackgroundComposition<F> {
  return { layers: [], generation: 0 };
}

export function topLayer<F extends FrameLike>(
  state: BackgroundComposition<F>,
): BackgroundLayer<F> | null {
  return state.layers[state.layers.length - 1] ?? null;
}

export function reduceComposition<F extends FrameLike>(
  state: BackgroundComposition<F>,
  event: CompositionEvent<F>,
): BackgroundComposition<F> {
  switch (event.type) {
    case "TARGET_CHANGED": {
      const top = topLayer(state);
      // Already targeting this track on top → nothing to do.
      if (top && top.frame.trackId === event.frame.trackId) return state;
      const generation = state.generation + 1;
      const layers = [
        ...state.layers,
        { frame: event.frame, generation, opacity: 0, ready: false },
      ];
      return prune({ layers, generation });
    }
    case "INCOMING_READY": {
      const top = topLayer(state);
      // Stale generation (a newer target already on top) → ignore.
      if (!top || top.generation !== event.generation || top.ready) return state;
      return { ...state, layers: replaceTop(state.layers, (l) => ({ ...l, ready: true })) };
    }
    case "ADVANCE": {
      const top = topLayer(state);
      if (!top?.ready) return state; // hold until ready — no flash
      const opacity = clamp01(event.progress);
      if (opacity === top.opacity) return state;
      return prune({
        ...state,
        layers: replaceTop(state.layers, (l) => ({ ...l, opacity })),
      });
    }
    default:
      return state;
  }
}

function replaceTop<F extends FrameLike>(
  layers: BackgroundLayer<F>[],
  update: (layer: BackgroundLayer<F>) => BackgroundLayer<F>,
): BackgroundLayer<F>[] {
  const last = layers.length - 1;
  return layers.map((l, i) => (i === last ? update(l) : l));
}

/**
 * Drop layers fully hidden by an opaque (opacity ≥ 1) upper layer, then cap the
 * stack length (dropping the oldest, most-covered layers as a backstop).
 */
function prune<F extends FrameLike>(state: BackgroundComposition<F>): BackgroundComposition<F> {
  let layers = state.layers;
  let opaqueIdx = -1;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (layers[i].opacity >= 1) {
      opaqueIdx = i;
      break;
    }
  }
  if (opaqueIdx > 0) layers = layers.slice(opaqueIdx);
  if (layers.length > MAX_BACKGROUND_LAYERS) {
    layers = layers.slice(layers.length - MAX_BACKGROUND_LAYERS);
  }
  return layers === state.layers ? state : { ...state, layers };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
