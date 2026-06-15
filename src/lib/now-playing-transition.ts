import { motionValue } from "motion/react";
import { create } from "zustand";

/**
 * Shared "transition" channel between the Now Playing cover stage (foreground)
 * and the ambient background (Background Frame Controller PRD, Phase 4 — the
 * Transition Driver).
 *
 * A song switch is one transition with FROZEN endpoints: `fromCoverUrl` /
 * `toCoverUrl` are captured when the gesture/switch begins and do NOT change for
 * its duration — even though the store's current-track index commits partway
 * through (commit-at-start). That's what lets the background crossfade the *right*
 * two covers all the way through the drag + its auto-complete, without ever
 * re-pointing at a third track (the stale-cover class, QA 图3), and reach 100%
 * exactly when the foreground card lands (QA 图1) because both read the same
 * normalized progress.
 *
 * Split by cadence: `transitionProgress` is a per-frame MotionValue (driven off
 * the React render path); the endpoints change only at begin/end (rare).
 */
export const transitionProgress = motionValue(0);

interface NowPlayingTransition {
  active: boolean;
  /** Frozen at begin — the cover crossfaded FROM (the at-start current). */
  fromCoverUrl: string | null;
  /** Frozen at begin — the cover crossfaded TO (the revealed neighbour). */
  toCoverUrl: string | null;
  begin: (fromCoverUrl: string | null, toCoverUrl: string | null) => void;
  end: () => void;
}

export const useNowPlayingTransition = create<NowPlayingTransition>((set) => ({
  active: false,
  fromCoverUrl: null,
  toCoverUrl: null,
  begin: (fromCoverUrl, toCoverUrl) =>
    set((s) =>
      s.active && s.fromCoverUrl === fromCoverUrl && s.toCoverUrl === toCoverUrl
        ? s
        : { active: true, fromCoverUrl, toCoverUrl },
    ),
  end: () => set((s) => (s.active ? { ...s, active: false } : s)),
}));
