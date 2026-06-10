import {
  MEMORY_ANCHOR_STALE_SEC,
  MEMORY_DISPLAY_MIN_SHOW_MS,
  memoryDisplayDurationMs,
} from "./memory-timeline";

/**
 * Pure scheduler for the immersive memory overlay (immersive-memory-moments PRD
 * §4.2). Driven by a tick (rAF / interval) while the Now-Playing foreground is
 * hidden. Two priority lanes:
 *  - **anchored** (`atSec` set): time-sensitive "this moment" cues. Fire when
 *    playback crosses their second; preempt a floating memory once it's had its
 *    minimum on-screen time; never preempt another anchored cue (queued instead).
 *  - **floating** (`atSec` absent): fillers shown round-robin in idle gaps.
 * A single slot, strictly sequential within a lane ("show one, then the next").
 * `nowMs` / `positionSec` / `rng` are injected so the whole thing is deterministic.
 */
export interface ImmersiveMemoryInput {
  id: string;
  note: string;
  hasPhoto: boolean;
  /** Playback anchor (seconds). Present → anchored lane; absent → floating lane. */
  atSec?: number;
}

export type ImmersiveLane = "anchored" | "floating";

export interface ImmersiveShowing {
  id: string;
  lane: ImmersiveLane;
  atSec?: number;
  startedAtMs: number;
  endsAtMs: number;
}

export interface ImmersiveMemoryState {
  showing: ImmersiveShowing | null;
  /** Anchors already fired this pass (cleared on backward seek / loop). */
  firedAnchorIds: string[];
  /** Anchored cues waiting for a free slot, in arrival order. */
  pendingAnchorIds: string[];
  floatingCursor: number;
  lastPositionSec: number;
}

export interface ImmersiveMemoryTick {
  nowMs: number;
  positionSec: number;
  isPlaying: boolean;
  memories: readonly ImmersiveMemoryInput[];
  /** Defaults to Math.random; inject for deterministic same-second tie-breaks. */
  rng?: () => number;
}

export interface ImmersiveMemoryResult {
  state: ImmersiveMemoryState;
  /** The memory to render now, or null for a clean top (just the spectrum). */
  activeId: string | null;
}

export const initialImmersiveMemoryState: ImmersiveMemoryState = {
  showing: null,
  firedAnchorIds: [],
  pendingAnchorIds: [],
  floatingCursor: 0,
  lastPositionSec: 0,
};

/** Backward jump beyond this (sec) counts as a seek/loop and re-arms anchors. */
const REARM_BACKWARD_EPS = 0.25;

export function scheduleImmersiveMemory(
  state: ImmersiveMemoryState,
  tick: ImmersiveMemoryTick,
): ImmersiveMemoryResult {
  const rng = tick.rng ?? Math.random;
  const { nowMs, positionSec, isPlaying } = tick;
  const byId = new Map(tick.memories.map((m) => [m.id, m] as const));
  const anchored = tick.memories.filter((m) => m.atSec != null);
  const floating = tick.memories.filter((m) => m.atSec == null);

  // Paused → freeze: keep the current memory on screen, advance nothing but the
  // position so a memory never vanishes mid-pause.
  if (!isPlaying) {
    return {
      state: { ...state, lastPositionSec: positionSec },
      activeId: state.showing?.id ?? null,
    };
  }

  let showing = state.showing;
  let firedAnchorIds = state.firedAnchorIds;
  let pendingAnchorIds = state.pendingAnchorIds;
  let floatingCursor = state.floatingCursor;

  // 1. Re-arm on backward seek / loop: forget anchors at/after the new position
  //    (so they can fire again) and drop now-irrelevant pending cues.
  if (positionSec < state.lastPositionSec - REARM_BACKWARD_EPS) {
    firedAnchorIds = firedAnchorIds.filter((id) => {
      const m = byId.get(id);
      return m?.atSec != null && m.atSec < positionSec;
    });
    pendingAnchorIds = [];
  }

  // 2. Fire anchors crossed in (lastPositionSec, positionSec]. Among everything
  //    crossed this tick surface ONE (random tie-break); mark them all fired so
  //    the rest never resurface and a skipped-over batch can't replay in full.
  const crossed = anchored.filter(
    (m) =>
      !firedAnchorIds.includes(m.id) &&
      m.atSec != null &&
      m.atSec > state.lastPositionSec &&
      m.atSec <= positionSec,
  );
  if (crossed.length > 0) {
    firedAnchorIds = [...firedAnchorIds, ...crossed.map((m) => m.id)];
    const chosen = crossed[Math.min(crossed.length - 1, Math.floor(rng() * crossed.length))];
    pendingAnchorIds = [...pendingAnchorIds, chosen.id];
  }

  // 3. Drop stale pending cues (would surface too long after their moment).
  pendingAnchorIds = pendingAnchorIds.filter((id) => {
    const m = byId.get(id);
    return m?.atSec != null && positionSec - m.atSec <= MEMORY_ANCHOR_STALE_SEC;
  });

  // 4. Expire the current memory once its dwell is up.
  if (showing && nowMs >= showing.endsAtMs) showing = null;

  // 5. An anchored cue preempts a *floating* memory once it has had its minimum
  //    on-screen time (it never preempts another anchored memory).
  if (
    showing &&
    showing.lane === "floating" &&
    pendingAnchorIds.length > 0 &&
    nowMs - showing.startedAtMs >= MEMORY_DISPLAY_MIN_SHOW_MS
  ) {
    showing = null;
  }

  // 6. Fill an empty slot: anchored cues first, then floating round-robin.
  if (!showing) {
    if (pendingAnchorIds.length > 0) {
      const [headId, ...rest] = pendingAnchorIds;
      pendingAnchorIds = rest;
      const m = byId.get(headId);
      if (m) showing = startShowing(m, "anchored", nowMs);
    } else if (floating.length > 0) {
      const m = floating[floatingCursor % floating.length];
      floatingCursor = (floatingCursor + 1) % floating.length;
      showing = startShowing(m, "floating", nowMs);
    }
  }

  return {
    state: {
      showing,
      firedAnchorIds,
      pendingAnchorIds,
      floatingCursor,
      lastPositionSec: positionSec,
    },
    activeId: showing?.id ?? null,
  };
}

function startShowing(
  m: ImmersiveMemoryInput,
  lane: ImmersiveLane,
  nowMs: number,
): ImmersiveShowing {
  return {
    id: m.id,
    lane,
    atSec: m.atSec,
    startedAtMs: nowMs,
    endsAtMs: nowMs + memoryDisplayDurationMs(m),
  };
}
