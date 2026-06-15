import { motionValue } from "motion/react";
import { create } from "zustand";

/**
 * Shared channel between the Now Playing cover stage and the ambient background
 * so the background can crossfade WITH a drag (PRD Phase 2-D). The stage and the
 * background live in separate component trees, so a module singleton is the link.
 *
 * Two parts, by update cadence:
 *  - `nowPlayingDragX`: a single MotionValue carrying the live drag offset (px).
 *    Written every pointer frame by the stage; read off the React render path by
 *    the background (a MotionValue subscription drives canvas opacity directly),
 *    so the per-frame drag never re-renders either tree.
 *  - `useNowPlayingDragRing`: the prev/cur/next cover URLs + stage width. These
 *    change only on a track switch (rare), so a normal Zustand store is fine.
 */
export const nowPlayingDragX = motionValue(0);

interface NowPlayingDragRing {
  /** Cover width in px — one full drag step (for progress normalization). */
  width: number;
  currentUrl: string | null;
  nextUrl: string | null;
  prevUrl: string | null;
  setRing: (ring: {
    width: number;
    currentUrl: string | null;
    nextUrl: string | null;
    prevUrl: string | null;
  }) => void;
}

export const useNowPlayingDragRing = create<NowPlayingDragRing>((set) => ({
  width: 0,
  currentUrl: null,
  nextUrl: null,
  prevUrl: null,
  setRing: (ring) =>
    set((s) =>
      s.width === ring.width &&
      s.currentUrl === ring.currentUrl &&
      s.nextUrl === ring.nextUrl &&
      s.prevUrl === ring.prevUrl
        ? s
        : ring,
    ),
}));
