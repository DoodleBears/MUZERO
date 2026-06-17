import { animate, motion } from "motion/react";
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import {
  albumCoverAppearanceVars,
  resolveAlbumCoverAppearance,
} from "@/lib/album-cover-appearance";
import { coverPaletteFromThumbhash, normalizeCoverPalette } from "@/lib/cover-palette";
import { transitionProgress, useNowPlayingTransition } from "@/lib/now-playing-transition";
import { trackHasCover } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import type { Rgb } from "@/lib/visualizer-color";
import { usePlayerStore } from "@/stores/player-store";
import { getVisualizerCoverColorRgb } from "@/stores/visualizer-color-store";
import { pendingRecenterSteps } from "./cover-pager";
import { CoverPagerStrip, type StripSlot } from "./cover-pager-strip";
import type { CoverPreloadCandidate } from "./cover-preload";
import {
  type CoverWindowSlot,
  clearCoverWindow,
  coverWindowOffset,
  setCoverWindow,
} from "./cover-window-store";
import { MediaStage } from "./media-stage";
import { StageIdentity } from "./stage-identity";
import { StageTitleFallback } from "./stage-title-fallback";
import { usePreloadedCoverUrls } from "./use-preloaded-cover-urls";

/** Visible window half-width: centre + 2 covers each side (the side covers ride
 *  the coverflow tilt; the third is off-screen). 5 persistent slots/sprites. */
const RADIUS = 2;
const FALLBACK_WIDTH = 360;
const DRAG_GAIN = 2;
const COMMIT_FRACTION = 0.16;
const MIN_COMMIT_DISTANCE = 44;
const MAX_COMMIT_DISTANCE = 96;
const SWITCH_DURATION_SEC = 0.62;
const SNAP_DURATION_SEC = 0.42;
const COMMIT_EASE = [0.22, 1, 0.36, 1] as const;
const COVERFLOW_TILT = 34;
const SIDE_SCALE = 0.86;
// Fallback to begin the hand-off if the base never reports the committed cover (a
// coverless / title-only track, where MediaStage's onCoverReady may not fire).
const HANDOFF_FALLBACK_MS = 600;
// The overlay fades out over the base (now on the committed cover) instead of
// snapping away — masking any base cover crossfade so the just-left cover can't
// flash through at the commit ("松手到 D 时闪一下 A").
const HANDOFF_FADE_MS = 280;
// After the base REPORTS the committed cover (at its crossfade's start), wait this
// long before revealing — long enough for the base's own A→B cover crossfade to land
// on B while still hidden, so the reveal never exposes the base mid-crossfade.
const HANDOFF_BASE_SETTLE_MS = 260;
// Trackpad / horizontal-wheel swipe (no pointerup → debounced end).
const WHEEL_GAIN = 1;
const WHEEL_ENGAGE_PX = 10;
const WHEEL_END_MS = 140;

/**
 * Best-effort synchronous cover accent, matching what the window border settles to:
 * the stored palette's first color, else the thumbhash-derived color.
 */
function trackBorderRgb(track: Track | undefined): Rgb | null {
  if (!track) return null;
  const stored = normalizeCoverPalette(track.coverPalette)[0];
  if (stored) return stored;
  return normalizeCoverPalette(coverPaletteFromThumbhash(track.coverThumbhash))[0] ?? null;
}

/**
 * Now Playing cover stage — a windowed, continuously-draggable coverflow.
 *
 * The cover strip is a persistent ±RADIUS recycling window (cover-pager-strip):
 * the user can drag it, and BEFORE a slide settles grab the incoming cover and
 * keep dragging to the song after that, indefinitely, in either direction. The
 * visual centre (`centerIndex`) LEADS the committed player-store `currentIndex`;
 * the store is committed only once the gesture settles (so the background resting
 * layer never re-points onto an undecoded cover mid-slide — the old "闪黑"). The
 * shared `coverWindowOffset` MotionValue + the pushed window content drive the
 * ambient Pixi background in lockstep (cover-window-store).
 */
export function SwipeableCoverStage({
  className,
  coverRef,
  foregroundVisible = true,
  onTap,
}: {
  className?: string;
  coverRef?: RefObject<HTMLDivElement | null>;
  foregroundVisible?: boolean;
  /** Fired on a plain tap of the cover (no swipe) — e.g. toggle lyrics on mobile. */
  onTap?: () => void;
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const coverAppearanceVars = albumCoverAppearanceVars(
    resolveAlbumCoverAppearance(settings),
  ) as CSSProperties;

  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const setStageRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      if (coverRef) coverRef.current = el;
    },
    [coverRef],
  );

  const [width, setWidth] = useState(FALLBACK_WIDTH);
  // Visual centre; leads the committed `currentIndex` during a drag/animation.
  const [centerIndex, setCenterIndex] = useState(() => usePlayerStore.getState().currentIndex);
  const centerIndexRef = useRef(centerIndex);
  centerIndexRef.current = centerIndex;
  // The overlay coverflow is shown only while a gesture / programmatic slide / its
  // hand-off is in flight; at rest the base MediaStage owns the cover (and video).
  const [active, setActive] = useState(false);
  // Sub-phase of `active`: the overlay is fading out over the settled base.
  const [handoffFading, setHandoffFading] = useState(false);
  const [baseCoverShownId, setBaseCoverShownId] = useState<string | undefined>(undefined);
  // The cover box's viewport rect — the overlay portals out to `main` (escaping the
  // scroll container's clip) and is positioned here, so a cover sliding in from the
  // side isn't clipped by the stage's bounds.
  const [overlayRect, setOverlayRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  // Gesture / animation bookkeeping (non-reactive).
  const tapStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const tapMoved = useRef(false);
  const draggingRef = useRef(false);
  const activeAnimation = useRef<{ stop: () => void } | null>(null);
  // Steps already recentered during the current gesture (drag offset baseline).
  const consumedRef = useRef(0);
  // A pending recenter whose visual offset reset is deferred to a layout effect, so
  // the offset only drops by `delta` once the rotated content has committed (no
  // wrong-cover frame). 0 = none.
  const pendingResetRef = useRef(0);
  const handoffTimer = useRef<number | null>(null);
  // True between the settle-commit and the overlay fade — the base-ready effect uses
  // this (not the timer, which only the coverless fallback sets) to know it's the
  // commit hand-off, so it waits for the base to actually paint the committed cover.
  const awaitingHandoffRef = useRef(false);
  // The track id this gesture is settling/committing to, so the external-switch
  // sync doesn't replay our own commit as a programmatic slide.
  const selfCommitRef = useRef<number | null>(null);
  // Wheel bookkeeping.
  const wheelEngaged = useRef(false);
  const wheelEndTimer = useRef<number | null>(null);

  const stepPx = Math.max(width, FALLBACK_WIDTH);

  // The ±RADIUS window of tracks around the VISUAL centre (mode-aware). Recomputed
  // when the centre moves or the queue / repeat / shuffle changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: queue/repeat/shuffle gate the non-reactive store read
  const win = useMemo(
    () => usePlayerStore.getState().peekWindowFrom(centerIndex, RADIUS),
    [centerIndex, queue, repeat, shuffle],
  );

  // Tracks by offset (-RADIUS..+RADIUS) → preload candidates → resolved cover urls.
  const offsetTracks = useMemo(() => {
    const map = new Map<number, Track>();
    if (win.current) map.set(0, win.current);
    win.prev.forEach((track, k) => {
      map.set(-(k + 1), track);
    });
    win.next.forEach((track, k) => {
      map.set(k + 1, track);
    });
    return map;
  }, [win]);

  const candidates = useMemo<CoverPreloadCandidate[]>(() => {
    const out: CoverPreloadCandidate[] = [];
    // Decode order = preload priority (preloadCoverBatch resolves serially). Order by
    // DISTANCE so the immediate neighbours decode before the far stack slots, and put
    // +offset (next) before -offset at the same distance: on a single-step drag the
    // incoming cover is always a ±1, and forward (next) is the common direction — so
    // the cover the user is sliding toward decodes first instead of 4th-in-line, where
    // a fast drag's next recenter cancelled the batch before it loaded (the coverflow
    // flattening to a title pan, PRD 20260618 #2).
    const offsets = [...offsetTracks.keys()].sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
    for (const offset of offsets) {
      const track = offsetTracks.get(offset);
      if (!track) continue;
      const role =
        offset === 0
          ? "current"
          : offset === -1
            ? "previous"
            : offset === 1
              ? "next"
              : offset < 0
                ? "stack-previous"
                : "stack-next";
      out.push({ role, track });
    }
    return out;
  }, [offsetTracks]);

  // A drag/animation wants the neighbour covers NOW → bypass the non-current defer.
  const coverUrls = usePreloadedCoverUrls(candidates, active);

  const slots = useMemo<StripSlot[]>(() => {
    const out: StripSlot[] = [];
    for (let offset = -RADIUS; offset <= RADIUS; offset += 1) {
      const track = offsetTracks.get(offset);
      out.push({
        slotKey: offset + RADIUS,
        offsetSteps: offset,
        content: track
          ? {
              trackId: track.id,
              coverUrl: trackHasCover(track) ? (coverUrls[track.id] ?? null) : null,
            }
          : null,
      });
    }
    return out;
  }, [offsetTracks, coverUrls]);

  // Publish the window to the shared channel (the Pixi background mirrors it). Only
  // the image covers of slots are pushed; the active flag tells the background to
  // run the lockstep sprite window vs its single-step resting path.
  useEffect(() => {
    if (!foregroundVisible) {
      clearCoverWindow();
      return;
    }
    const windowSlots: CoverWindowSlot[] = slots
      .filter((slot) => slot.content)
      .map((slot) => ({
        offsetSteps: slot.offsetSteps,
        // biome-ignore lint/style/noNonNullAssertion: filtered to non-null content
        trackId: slot.content!.trackId,
        // biome-ignore lint/style/noNonNullAssertion: filtered to non-null content
        coverUrl: slot.content!.coverUrl,
      }));
    setCoverWindow({ active, slots: windowSlots });
  }, [active, foregroundVisible, slots]);

  // Measure the cover box (drives step px + drop-target rect for the caller).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width || FALLBACK_WIDTH);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stopAnimation = useCallback(() => {
    activeAnimation.current?.stop();
    activeAnimation.current = null;
  }, []);

  // Deferred offset reset: once the rotated content for a recenter has committed,
  // subtract the consumed step from the live offset so the cover that was at the
  // boundary stays put (no jump). `centerIndex` is the TRIGGER (run after the
  // recentered content commits, before paint), not a value the body reads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: centerIndex is the run-on-recenter trigger
  useLayoutEffect(() => {
    if (pendingResetRef.current === 0) return;
    const delta = pendingResetRef.current;
    pendingResetRef.current = 0;
    consumedRef.current += delta;
    coverWindowOffset.set(coverWindowOffset.get() - delta);
  }, [centerIndex]);

  const recenterBy = useCallback((step: -1 | 1) => {
    // step in OFFSET units: negative = dragged toward next ⇒ centre advances (+1).
    const dir: 1 | -1 = step < 0 ? 1 : -1;
    centerIndexRef.current = usePlayerStore.getState().stepCenter(centerIndexRef.current, dir);
    pendingResetRef.current += step;
    setCenterIndex(centerIndexRef.current);
  }, []);

  const beginGesture = useCallback(() => {
    stopAnimation();
    if (handoffTimer.current != null) {
      window.clearTimeout(handoffTimer.current);
      handoffTimer.current = null;
    }
    draggingRef.current = true;
    consumedRef.current = 0;
    pendingResetRef.current = 0;
    coverWindowOffset.set(0);
    usePlayerStore.getState().setCoverGestureActive(true);
    setActive(true);
  }, [stopAnimation]);

  const driveOffset = useCallback(
    (offsetSteps: number) => {
      coverWindowOffset.set(offsetSteps);
      const delta = pendingRecenterSteps(offsetSteps);
      if (delta !== 0 && pendingResetRef.current === 0) {
        recenterBy(delta < 0 ? -1 : 1);
      }
    },
    [recenterBy],
  );

  // Tear the overlay down immediately (tap / far jump / teardown).
  const closeOverlay = useCallback(() => {
    if (handoffTimer.current != null) {
      window.clearTimeout(handoffTimer.current);
      handoffTimer.current = null;
    }
    awaitingHandoffRef.current = false;
    setHandoffFading(false);
    setActive(false);
    coverWindowOffset.set(0);
    useNowPlayingTransition.getState().end();
    transitionProgress.set(0);
  }, []);

  // Hand off to the base by FADING the overlay out over it (base already on the
  // committed cover), instead of snapping — so a base cover crossfade can't flash the
  // just-left cover through. The window stays pushed (active) through the fade so the
  // Pixi background only re-points once the foreground has finished.
  const beginHandoffFade = useCallback(() => {
    if (handoffTimer.current != null) window.clearTimeout(handoffTimer.current);
    awaitingHandoffRef.current = false;
    setHandoffFading(true);
    handoffTimer.current = window.setTimeout(() => {
      handoffTimer.current = null;
      closeOverlay();
    }, HANDOFF_FADE_MS);
  }, [closeOverlay]);

  const commitAndHandoff = useCallback(() => {
    draggingRef.current = false;
    consumedRef.current = 0;
    usePlayerStore.getState().setCoverGestureActive(false);
    const target = centerIndexRef.current;
    const targetTrack = usePlayerStore.getState().queue[target];
    if (target !== usePlayerStore.getState().currentIndex) {
      selfCommitRef.current = target;
      void usePlayerStore.getState().playIndex(target);
    }
    if (handoffTimer.current != null) window.clearTimeout(handoffTimer.current);
    awaitingHandoffRef.current = true;
    // For a COVERED target, wait strictly until the base has PAINTED that cover before
    // fading (the base is burst-settled, so it shows the old cover for ~300ms — a
    // premature fade would flash it: "松手到 D 时闪一下 A"). Only a coverless target —
    // whose base may never fire onCoverReady — uses the timed fallback.
    if (!(targetTrack && trackHasCover(targetTrack))) {
      handoffTimer.current = window.setTimeout(beginHandoffFade, HANDOFF_FALLBACK_MS);
    }
  }, [beginHandoffFade]);

  // Once the base stage REPORTS the committed cover, schedule the fade — but with a
  // short settle delay first: the base reports at its cover crossfade's START (see
  // CanvasCover.onShown), so revealing immediately would expose the base mid A→B
  // crossfade = the cover A-flash. The base crossfade plays while it's hidden, so a
  // small delay lets it land on B before we reveal. (One-shot per commit.)
  useEffect(() => {
    if (!active || handoffFading || draggingRef.current) return;
    if (!awaitingHandoffRef.current) return; // not in the commit hand-off
    const target = usePlayerStore.getState().queue[centerIndexRef.current];
    if (target && baseCoverShownId === target.id) {
      awaitingHandoffRef.current = false; // scheduled — don't re-arm
      if (handoffTimer.current != null) window.clearTimeout(handoffTimer.current);
      handoffTimer.current = window.setTimeout(beginHandoffFade, HANDOFF_BASE_SETTLE_MS);
    }
  }, [active, handoffFading, baseCoverShownId, beginHandoffFade]);

  const updateOverlayRect = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setOverlayRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    }
  }, []);

  const animateOffsetTo = useCallback(
    (target: number, durationSec: number, onDone: () => void) => {
      stopAnimation();
      const controls = animate(coverWindowOffset, target, {
        duration: durationSec,
        ease: COMMIT_EASE,
        type: "tween",
      });
      activeAnimation.current = controls;
      void controls.then(() => {
        if (activeAnimation.current !== controls) return;
        activeAnimation.current = null;
        onDone();
      });
    },
    [stopAnimation],
  );

  const settle = useCallback(() => {
    draggingRef.current = false;
    const offset = coverWindowOffset.get();
    const thresholdSteps =
      Math.min(MAX_COMMIT_DISTANCE, Math.max(MIN_COMMIT_DISTANCE, stepPx * COMMIT_FRACTION)) /
      stepPx;
    const target = offset <= -thresholdSteps ? -1 : offset >= thresholdSteps ? 1 : 0;
    animateOffsetTo(target, SNAP_DURATION_SEC, () => {
      if (target !== 0) recenterBy(target < 0 ? -1 : 1);
      commitAndHandoff();
    });
  }, [animateOffsetTo, commitAndHandoff, recenterBy, stepPx]);

  // Border-color crossfade for the current drag direction (the blur background +
  // window border read this). Begun lazily once a direction is known.
  const beginBorderTransition = useCallback(
    (dir: 1 | -1) => {
      const center = queue[centerIndexRef.current];
      const neighbour = dir < 0 ? (win.next[0] ?? undefined) : (win.prev[0] ?? undefined);
      useNowPlayingTransition
        .getState()
        .begin(coverUrls[center?.id ?? ""] ?? null, coverUrls[neighbour?.id ?? ""] ?? null, {
          from: getVisualizerCoverColorRgb() ?? trackBorderRgb(center),
          to: trackBorderRgb(neighbour),
        });
    },
    [coverUrls, queue, win.next, win.prev],
  );
  const borderDirRef = useRef<1 | -1 | 0>(0);

  // Keep `transitionProgress` (border + blur crossfade) following the drag, and
  // (re)begin the from→to pair when the direction flips or a recenter lands.
  useEffect(() => {
    if (!active) {
      borderDirRef.current = 0;
      return;
    }
    // A chained drag that crosses a step recentres the window (centre/neighbour
    // advance) WITHOUT flipping the drag direction, and resets the offset to ~0. The
    // dir-flip check below won't re-base the frozen border pair, so it kept crossfading
    // the PREVIOUS centre's pair (0→1) while progress reset to ~0 — snapping the border
    // back to the old `from` (0's colour) instead of gliding on to the next (1→2). This
    // effect re-runs on a recentre (beginBorderTransition closes over the NEW
    // neighbour), so re-base the pair to the new centre→neighbour whenever a directional
    // drag is in flight. (PRD 20260618-recenter-boundary #1.)
    if (borderDirRef.current === 1 || borderDirRef.current === -1) {
      beginBorderTransition(borderDirRef.current);
    }
    const apply = (offset: number) => {
      const dir: 1 | -1 | 0 = offset < -0.001 ? -1 : offset > 0.001 ? 1 : 0;
      if (dir !== 0 && dir !== borderDirRef.current) {
        borderDirRef.current = dir;
        beginBorderTransition(dir);
      }
      transitionProgress.set(Math.min(1, Math.abs(offset)));
    };
    apply(coverWindowOffset.get());
    return coverWindowOffset.on("change", apply);
  }, [active, beginBorderTransition]);

  // External (programmatic) switch — transport buttons, Q/E, auto-advance, queue
  // click, Dock drag. The store already moved; animate the coverflow to catch up, or
  // snap on a far jump / a burst that outruns the slide.
  //
  // LAYOUT effect (not passive): engage the masking overlay BEFORE the first paint of
  // the new `currentIndex`. As a passive effect it lagged one frame, so for that frame
  // the base stage decoded + painted the new cover UNMASKED — the extra switch-frame
  // cost that made an external switch (esp. Dock drag) jankier than the cover's own
  // gesture, whose overlay is already active. Running here hides the base (opacity 0)
  // on the same commit, so the base cover work happens behind the slide, not on the
  // critical frame. (PRD 20260617-dock-swipe-switch-jank Phase 2.)
  useLayoutEffect(() => {
    if (currentIndex < 0) return;
    if (currentIndex === centerIndexRef.current) {
      // Our own settle-commit (or already aligned) — clear the self tag, no replay.
      if (selfCommitRef.current === currentIndex) selfCommitRef.current = null;
      return;
    }
    if (draggingRef.current) return; // don't fight the finger
    const from = centerIndexRef.current;
    const burst = activeAnimation.current != null;
    const nextCenter = usePlayerStore.getState().stepCenter(from, 1);
    const prevCenter = usePlayerStore.getState().stepCenter(from, -1);
    const adjacentDir: 1 | -1 | 0 =
      currentIndex === nextCenter ? -1 : currentIndex === prevCenter ? 1 : 0;
    if (burst || adjacentDir === 0) {
      // Far jump or rapid burst: snap the window to the new centre, no slide.
      stopAnimation();
      coverWindowOffset.set(0);
      centerIndexRef.current = currentIndex;
      setCenterIndex(currentIndex);
      // The store is already on this track; let the base own it (no hand-off needed).
      closeOverlay();
      return;
    }
    setActive(true);
    updateOverlayRect();
    animateOffsetTo(adjacentDir, SWITCH_DURATION_SEC, () => {
      recenterBy(adjacentDir);
      // Base already shows `currentIndex`; fade the overlay out over it.
      beginHandoffFade();
    });
  }, [
    currentIndex,
    animateOffsetTo,
    beginHandoffFade,
    closeOverlay,
    recenterBy,
    stopAnimation,
    updateOverlayRect,
  ]);

  // At rest, keep the visual centre pinned to the committed track id (a queue edit
  // that shifts indices, or boot). Only when nothing is in flight.
  useEffect(() => {
    if (active || draggingRef.current) return;
    if (currentIndex >= 0 && currentIndex !== centerIndexRef.current) {
      centerIndexRef.current = currentIndex;
      setCenterIndex(currentIndex);
    }
  }, [active, currentIndex]);

  // Teardown: leaving the tab / unmount mid-drag must release everything and leave
  // the store on a coherent (committed) track.
  useEffect(() => {
    if (foregroundVisible) return;
    stopAnimation();
    if (handoffTimer.current != null) {
      window.clearTimeout(handoffTimer.current);
      handoffTimer.current = null;
    }
    draggingRef.current = false;
    usePlayerStore.getState().setCoverGestureActive(false);
    setActive(false);
    coverWindowOffset.set(0);
    useNowPlayingTransition.getState().end();
    transitionProgress.set(0);
  }, [foregroundVisible, stopAnimation]);

  useEffect(
    () => () => {
      activeAnimation.current?.stop();
      if (handoffTimer.current != null) window.clearTimeout(handoffTimer.current);
      if (wheelEndTimer.current != null) window.clearTimeout(wheelEndTimer.current);
      usePlayerStore.getState().setCoverGestureActive(false);
      clearCoverWindow();
      useNowPlayingTransition.getState().end();
      transitionProgress.set(0);
    },
    [],
  );

  // Horizontal trackpad / wheel swipe → same windowed drag (debounced end).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const accum = { v: 0 };
    const finishWheel = () => {
      wheelEndTimer.current = null;
      if (wheelEngaged.current) settle();
      wheelEngaged.current = false;
      accum.v = 0;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX === 0 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (wheelEndTimer.current != null) window.clearTimeout(wheelEndTimer.current);
      wheelEndTimer.current = window.setTimeout(finishWheel, WHEEL_END_MS);
      const delta = (-e.deltaX * WHEEL_GAIN * DRAG_GAIN) / stepPx;
      if (!wheelEngaged.current) {
        accum.v += -e.deltaX;
        if (Math.abs(accum.v) < WHEEL_ENGAGE_PX) return;
        wheelEngaged.current = true;
        beginGesture();
      }
      driveOffset(coverWindowOffset.get() + delta);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [beginGesture, driveOffset, settle, stepPx]);

  // Keep the portal rect aligned with the cover box while the overlay is shown
  // (the page scrolls; the cover bleed clamps to viewport changes).
  useEffect(() => {
    if (!active) return;
    updateOverlayRect();
    let raf = 0;
    const onViewportChange = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        updateOverlayRect();
      });
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [active, updateOverlayRect]);

  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const renderFallback = useCallback(
    (trackId: string) => <StageTitleFallback track={queue.find((tk) => tk.id === trackId)} />,
    [queue],
  );
  const renderIdentity = useCallback(
    (trackId: string) => {
      const track = queue.find((tk) => tk.id === trackId);
      // Coverflow cards are transient (slide + fade out); render their titles STATIC
      // so a switch doesn't clone-to-body + reflow several marquees. The resting base
      // StageIdentity keeps the marquee. (PRD 20260617-dock-swipe-switch-jank #2.)
      return track ? <StageIdentity track={track} scroll={false} /> : null;
    },
    [queue],
  );
  const overlayPortalTarget =
    typeof document !== "undefined"
      ? (containerRef.current?.closest("main") ?? document.body)
      : null;

  return (
    <div data-no-drag className={cn("flex flex-col gap-2", className)} style={coverAppearanceVars}>
      <div
        ref={setStageRef}
        className="relative w-full overflow-visible [perspective:1200px] album-cover-radius"
      >
        <motion.div
          data-testid="now-cover-drag"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.24}
          dragMomentum={false}
          onPointerDown={(e) => {
            tapStart.current = { x: e.clientX, y: e.clientY, t: Date.now() };
            tapMoved.current = false;
            beginGesture();
          }}
          onPointerUp={(e) => {
            const start = tapStart.current;
            tapStart.current = null;
            const isTap =
              !!onTap &&
              !!start &&
              !tapMoved.current &&
              Date.now() - start.t < 400 &&
              Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10;
            if (isTap) {
              // A tap never moved the window — close it back to centre cleanly.
              draggingRef.current = false;
              usePlayerStore.getState().setCoverGestureActive(false);
              closeOverlay();
              onTap?.();
            }
          }}
          onDrag={(_, info) => {
            tapMoved.current = true;
            driveOffset((info.offset.x * DRAG_GAIN) / stepPx - consumedRef.current);
          }}
          onDragEnd={() => settle()}
          aria-label={`${t("player.previous")} / ${t("player.next")}`}
          className="relative z-10 w-full touch-pan-y cursor-grab select-none overflow-visible active:cursor-grabbing album-cover-radius [&_*]:select-none [&_img]:pointer-events-none"
          style={{
            // Hide the base only once the overlay is on screen (rect measured) and not
            // during the hand-off fade — no blank frame at drag start, and the base is
            // revealed (on the committed cover) as the overlay fades out.
            opacity: active && overlayRect && !handoffFading ? 0 : 1,
            willChange: "transform",
          }}
        >
          <MediaStage
            coverBacklightEnabled={foregroundVisible && !active}
            onCoverReady={setBaseCoverShownId}
          />
        </motion.div>
      </div>
      {/* The title/author block: hidden ONLY while the overlay still owns the
          travelling identity (a live drag/slide). At the commit hand-off the base
          already renders the committed track, so reveal it the instant the fade
          begins — text has no decode/crossfade to mask (unlike the cover), so
          riding the cover's fade-out just made the same title blink out then pop
          back (PRD 20260618 #1). Kept mounted so the layout doesn't jump. */}
      <div
        style={{
          opacity: active && !handoffFading ? 0 : 1,
          pointerEvents: active && !handoffFading ? "none" : "auto",
        }}
      >
        {current && <StageIdentity track={current} />}
      </div>
      {/* Windowed coverflow overlay — PORTALED out to `main` so a cover sliding in
          from the side (and its travelling title) isn't clipped by the stage box.
          Positioned at the measured cover rect; fades out at the commit hand-off. */}
      {foregroundVisible &&
        active &&
        overlayRect &&
        overlayPortalTarget &&
        createPortal(
          <motion.div
            aria-hidden
            className="pointer-events-none fixed z-20 overflow-visible [perspective:1200px]"
            initial={false}
            animate={{ opacity: handoffFading ? 0 : 1 }}
            transition={{ duration: HANDOFF_FADE_MS / 1000, ease: "easeOut" }}
            style={{
              top: overlayRect.top,
              left: overlayRect.left,
              width: overlayRect.width,
              height: overlayRect.height,
              ...coverAppearanceVars,
            }}
          >
            <CoverPagerStrip
              renderFallback={renderFallback}
              // Drop the travelling identity the instant the hand-off fade begins:
              // the base identity is revealed at full opacity on the same commit, so
              // keeping the overlay copy would briefly double-render the same title
              // (and ride the cover fade-out). Only the cover image needs the fade.
              renderIdentity={handoffFading ? undefined : renderIdentity}
              sideScale={SIDE_SCALE}
              slots={slots}
              tilt={COVERFLOW_TILT}
              width={overlayRect.width || width}
            />
          </motion.div>,
          overlayPortalTarget,
        )}
    </div>
  );
}
