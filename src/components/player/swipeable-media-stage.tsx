import {
  animate,
  type MotionValue,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
} from "motion/react";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AutoScrollText } from "@/components/ui/auto-scroll-text";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { useCoverDerivativeUrl, useTrackCoverResource } from "@/hooks/use-media";
import {
  albumCoverAppearanceVars,
  resolveAlbumCoverAppearance,
  resolveNowPlayingCoverBacklightAppearance,
  resolveNowPlayingCoverEffectMode,
} from "@/lib/album-cover-appearance";
import { coverPaletteFromThumbhash, normalizeCoverPalette } from "@/lib/cover-palette";
import { matchActiveQualityPreset } from "@/lib/graphics-quality";
import { log } from "@/lib/logger";
import { transitionProgress, useNowPlayingTransition } from "@/lib/now-playing-transition";
import { trackAlbum, trackArtists, trackHasCover, trackSubtitle } from "@/lib/track-display";
import {
  manualProgress,
  remainingDurationMs,
  dragDirection as resolveDragDirection,
  shouldCommitRelease,
} from "@/lib/transition-driver";
import { cn } from "@/lib/utils";
import type { Rgb } from "@/lib/visualizer-color";
import { TRANSPORT_SWITCH_MIN_INTERVAL_MS } from "@/shortcuts/transport-throttle";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import { getVisualizerCoverColorRgb } from "@/stores/visualizer-color-store";
import { CanvasCover } from "./canvas-cover";
import type { CoverPreloadCandidate } from "./cover-preload";
import { MediaStage } from "./media-stage";
import { StageTitleFallback } from "./stage-title-fallback";
import { usePreloadedCoverUrls } from "./use-preloaded-cover-urls";

/**
 * Best-effort synchronous cover accent for a track, matching what the window border
 * settles to: the stored palette's first color, else the thumbhash-derived color.
 * Null when neither is available (the border then just keeps its current color through
 * the drag and lets the post-switch settle catch up).
 */
function trackBorderRgb(track: Track | undefined): Rgb | null {
  if (!track) return null;
  const stored = normalizeCoverPalette(track.coverPalette)[0];
  if (stored) return stored;
  return normalizeCoverPalette(coverPaletteFromThumbhash(track.coverThumbhash))[0] ?? null;
}

const FALLBACK_WIDTH = 360;
const COMMIT_FRACTION = 0.16;
const MIN_COMMIT_DISTANCE = 44;
const MAX_COMMIT_DISTANCE = 96;
const COMMIT_VELOCITY = 420;
const COMMIT_DURATION_SEC = 1.08;
// Switches triggered by buttons / Q-E / auto-advance animate the full travel
// from 0 (a drag only animates the remaining distance), so they use a snappier
// duration to feel responsive while keeping the same coverflow look.
const SWITCH_DURATION_SEC = 0.62;
// A programmatic switch arriving within this window of the previous one can't
// finish the 0.62s coverflow slide before the next one arrives, so we skip the
// slide and let the base MediaStage cover + Pixi background crossfade carry it
// directly. Quality mode tightens this to the transport cap (200ms) so the cover
// crossfade stays in lockstep with held Q/E (5/s).
const COVERFLOW_BURST_SKIP_MS = 600;
const HANDOFF_DURATION_SEC = 0.32;
const COVER_READY_SETTLE_MS = 440;
const COMMIT_EASE = [0.22, 1, 0.36, 1] as const;
const SNAP_EASE = [0.25, 1, 0.5, 1] as const;
const EXIT_TRAVEL_FRACTION = 0.92;
const DRAG_GAIN = 2;
// Drag distance (raw px) before a gesture commits to a direction — matches the
// 8px direction deadzone used while dragging (onDrag). Shared with the Transition
// Driver's `dragDirection` so the release decision uses the same sign rule.
const DRAG_DIRECTION_DEADZONE = 8;
// Trackpad / horizontal-wheel swipe: how much a deltaX pixel moves the strip,
// how much horizontal travel must accumulate before the gesture engages (so a
// near-vertical scroll doesn't nudge the cover), and how long after the last
// wheel tick we treat the swipe as finished.
const WHEEL_GAIN = 1;
const WHEEL_ENGAGE_PX = 10;
const WHEEL_END_MS = 140;
// Coverflow look: each cover pivots around its own centre as the strip slides.
const COVERFLOW_TILT = 34;
const SIDE_SCALE = 0.86;
const SWIPE_CARD_BASE =
  "pointer-events-none absolute inset-0 overflow-visible [backface-visibility:hidden] album-cover-radius";

export function SwipeableMediaStage({
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
  const x = useMotionValue(0);
  // Tap-vs-swipe bookkeeping for `onTap` (a swipe sets `moved`, suppressing it).
  const tapStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const tapMoved = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The cover box is measured for the overlay portal and also serves as the
  // now-playing image drop target, so forward it to the caller's ref.
  const setStageRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      if (coverRef) coverRef.current = el;
    },
    [coverRef],
  );
  const activeAnimation = useRef<{ stop: () => void } | null>(null);
  const clearTimer = useRef<number | null>(null);
  const handoffTimer = useRef<number | null>(null);
  const animationToken = useRef(0);
  // Horizontal trackpad/wheel swipe bookkeeping (a wheel gesture has no
  // pointerup, so its end is debounced and momentum after a commit is swallowed).
  const wheelEngaged = useRef(false);
  const wheelCommitted = useRef(false);
  const wheelAccum = useRef(0);
  const wheelEndTimer = useRef<number | null>(null);
  const wheelState = useRef<WheelState | null>(null);
  // The track id a user drag/wheel commit is switching to, so the store change
  // it causes isn't re-animated as if it had come from a button.
  const selfSwitchRef = useRef<string | null>(null);
  // Snapshot of the track + its peeks before the last change, so an external
  // switch (button / Q-E / auto-advance) can be turned into the right-direction
  // coverflow.
  const switchSnapRef = useRef<SwitchSnapshot | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [dragDirection, setDragDirection] = useState<SwipeDirection>(null);
  const [committing, setCommitting] = useState(false);
  const [handoffFading, setHandoffFading] = useState(false);
  const [stack, setStack] = useState<SwipeStack | null>(null);
  const [userGestureStack, setUserGestureStack] = useState(false);
  const [settleTarget, setSettleTarget] = useState<VisualTrack | null>(null);
  const [readyTrackIds, setReadyTrackIds] = useState<Record<string, true>>({});
  // Track id whose cover the BASE stage is currently PAINTING (reported by MediaStage).
  // The handoff waits for this to reach the committed track so the overlay never fades
  // while the base still shows the old cover (the "cover flashes black at the handoff").
  const [baseCoverShownId, setBaseCoverShownId] = useState<string | undefined>(undefined);
  const [overlayRect, setOverlayRect] = useState<StageOverlayRect | null>(null);
  // Rapid next/prev gate: when switches outpace the time a coverflow slide needs to
  // finish (held Q/E at the 200ms transport cap), we skip the 3D slide — which would
  // just be torn down and restarted every switch, jerking the cover — and let the
  // base cover crossfade carry it directly. The old "burst mode" ALSO suppressed the
  // backlight + 3D cards to save GPU; that's gone now that switch perf is fixed (the
  // cover keeps its backlight throughout), so this is just the slide/crossfade choice.
  const lastSwitchAtRef = useRef(0);

  const next = usePlayerStore((s) => s.next);
  const skipPrev = usePlayerStore((s) => s.skipPrev);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const nextTrack = usePlayerStore((s) => s.peekTrack("next"));
  const prevTrack = usePlayerStore((s) => s.peekTrack("prev"));
  const settings = useSettings();
  const coverEffectMode = resolveNowPlayingCoverEffectMode(settings.nowPlayingCoverEffectMode);
  // 画质优先 (the "quality" preset, also the app default) spares no expense on the switch
  // transition: play the coverflow + its backlight cards even on a fast burst — only skip
  // when switches outpace the transport rate cap (200ms / 5-per-sec). Balanced/battery keep
  // the snappier burst-skip (600ms). The cover backlight fade-in (below) is now unconditional
  // across all presets — the glow eases in after every switch instead of popping.
  const richSwitchTransitions = matchActiveQualityPreset(settings) === "quality";
  const coverflowBurstSkipMs = richSwitchTransitions
    ? TRANSPORT_SWITCH_MIN_INTERVAL_MS
    : COVERFLOW_BURST_SKIP_MS;
  const backlight = resolveNowPlayingCoverBacklightAppearance(settings);
  const coverEffect: SwipeCoverEffect = {
    backlightOpacity: backlight.opacity / 100,
    mode: coverEffectMode,
  };
  // The configurable cover radius/shadow apply to the Now Playing stage ONLY
  // (Settings is now scoped here, not global — see App.useAppearanceCssVars).
  // Setting the vars on the stage root cascades to every cover beneath it; the
  // coverflow overlay portals out into `main`, so it gets the same vars below.
  const coverAppearanceVars = albumCoverAppearanceVars(
    resolveAlbumCoverAppearance(settings),
  ) as CSSProperties;
  const stageCover = useTrackCoverResource(current);
  const preloadCandidates = useMemo<CoverPreloadCandidate[]>(
    () =>
      compactPreloadCandidates([
        { role: "current", track: current },
        { role: "previous", track: prevTrack },
        { role: "next", track: nextTrack },
        { role: "stack-current", track: stack?.current?.track },
        { role: "stack-previous", track: stack?.prev?.track },
        { role: "stack-next", track: stack?.next?.track },
        { role: "settle", track: settleTarget?.track },
      ]),
    [
      current,
      nextTrack,
      prevTrack,
      settleTarget?.track,
      stack?.current?.track,
      stack?.next?.track,
      stack?.prev?.track,
    ],
  );
  // While the user is actively dragging/peeking the coverflow they clearly want
  // the neighbour covers NOW — and a drag is never a rapid burst — so bypass the
  // 420ms non-current preload defer (which otherwise leaves prev/next showing the
  // title-only fallback when you drag to peek right after a switch). QA 图2.
  const preloadedCoverUrls = usePreloadedCoverUrls(
    preloadCandidates,
    userGestureStack,
    foregroundVisible,
  );
  const currentVisual = makeVisualTrack(current, preloadedCoverUrls);
  const nextVisual = makeVisualTrack(nextTrack, preloadedCoverUrls);
  const prevVisual = makeVisualTrack(prevTrack, preloadedCoverUrls);
  // Re-resolve a (possibly snapshotted) stack visual's cover from the LIVE preload
  // map. `beginGesture` freezes the visuals at gesture start, so a neighbour whose
  // cover hadn't preloaded yet was frozen with `initialCoverUrl: null` and the card
  // kept showing the title fallback even after its cover loaded. Looking it up live
  // keeps the frozen track identity but always paints the latest cover. QA 图2.
  const liveStackVisual = (visual: VisualTrack | null): VisualTrack | null =>
    visual ? makeVisualTrack(visual.track, preloadedCoverUrls) : null;
  const activeStack = stack ?? {
    current: currentVisual,
    next: nextVisual,
    prev: prevVisual,
  };
  const stackVisible = !!stack;
  const stackActive =
    stackVisible && (!!dragDirection || committing || !!settleTarget || handoffFading);
  const stageCoverSettledForCurrent =
    stageCover.readyForTrack &&
    (!stageCover.targetKey || !stageCover.url || stageCover.urlKey === stageCover.targetKey);
  const baseCoverBacklightEnabled = (!committing && !settleTarget) || handoffFading;

  const travel = Math.max(width, FALLBACK_WIDTH);
  const visualX = useTransform(x, (value) => value * DRAG_GAIN);
  const exitTravel = Math.max(300, Math.min(travel * EXIT_TRAVEL_FRACTION, 760));
  // Cards sit one "step" apart and the whole strip translates with the drag, so
  // each cover pivots around its own centre (no door-hinge overlap). One commit
  // moves the strip exactly one step, landing the incoming cover dead-centre.
  const step = exitTravel;
  const tilt = COVERFLOW_TILT;
  const sideScale = SIDE_SCALE;
  const currentCard = useCoverflowCard(visualX, 0, step, tilt, sideScale);
  const nextCard = useCoverflowCard(visualX, step, step, tilt, sideScale);
  const prevCard = useCoverflowCard(visualX, -step, step, tilt, sideScale);

  // Drive the shared Transition (Phase 4): the foreground card and the ambient
  // background read the SAME normalized progress + FROZEN from/to covers, so the
  // background crossfades the right two covers all the way through the drag AND
  // its auto-complete — reaching the incoming exactly when the card lands (图1)
  // and never re-pointing at a third track mid-commit (图3). `manualProgress`
  // normalizes the drag to one card "step" (`visualX = x·DRAG_GAIN` lands at
  // `step`), so progress hits 1 when the card lands. The transition is begun only
  // from a real pointer drag (see onDrag); button/keyboard switches also animate
  // `x`/`dragDirection` but never begin a transition, so the controller keeps
  // handling them (no double crossfade). End it when the gesture settles.
  const beginTransition = useNowPlayingTransition((s) => s.begin);
  const endTransition = useNowPlayingTransition((s) => s.end);
  useMotionValueEvent(x, "change", (v) => {
    transitionProgress.set(manualProgress(v * DRAG_GAIN, step));
  });
  useEffect(() => {
    if (dragDirection) return;
    endTransition();
    transitionProgress.set(0);
  }, [dragDirection, endTransition]);
  useEffect(
    () => () => {
      endTransition();
      transitionProgress.set(0);
    },
    [endTransition],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width || FALLBACK_WIDTH);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const updateOverlayRect = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clipBounds = measureVerticalClipBounds(containerRef.current);
    setOverlayRect({
      clipBottomInset: rect.bottom - clipBounds.bottom,
      clipTopInset: clipBounds.top - rect.top,
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    });
  }, []);

  useEffect(() => {
    if (!stackVisible) {
      setOverlayRect(null);
      return;
    }
    updateOverlayRect();
    // Coalesce capture-phase scroll bursts (Lenis emits many per frame) into one
    // measurement per frame: a raw listener would run getBoundingClientRect +
    // measureVerticalClipBounds (a parent-chain getComputedStyle walk) on every
    // event = forced sync layout thrash during a switch scroll (PRD Phase 30).
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
  }, [stackVisible, updateOverlayRect]);

  useEffect(() => {
    return () => {
      activeAnimation.current?.stop();
      if (clearTimer.current != null) window.clearTimeout(clearTimer.current);
      if (handoffTimer.current != null) window.clearTimeout(handoffTimer.current);
      if (wheelEndTimer.current != null) window.clearTimeout(wheelEndTimer.current);
    };
  }, []);

  const clearStack = useCallback(() => {
    activeAnimation.current?.stop();
    activeAnimation.current = null;
    if (clearTimer.current != null) {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    if (handoffTimer.current != null) {
      window.clearTimeout(handoffTimer.current);
      handoffTimer.current = null;
    }
    animationToken.current += 1;
    x.set(0);
    setDragDirection(null);
    setCommitting(false);
    setHandoffFading(false);
    setSettleTarget(null);
    setReadyTrackIds({});
    setOverlayRect(null);
    setUserGestureStack(false);
    setStack(null);
  }, [x]);

  useEffect(() => {
    if (!foregroundVisible && stackVisible) clearStack();
  }, [clearStack, foregroundVisible, stackVisible]);

  const markVisualReady = useCallback((trackId: string) => {
    setReadyTrackIds((ready) => (ready[trackId] ? ready : { ...ready, [trackId]: true }));
  }, []);

  const beginGesture = useCallback(() => {
    activeAnimation.current?.stop();
    activeAnimation.current = null;
    if (clearTimer.current != null) {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    if (handoffTimer.current != null) {
      window.clearTimeout(handoffTimer.current);
      handoffTimer.current = null;
    }
    animationToken.current += 1;
    x.set(0);
    setDragDirection(null);
    setCommitting(false);
    setHandoffFading(false);
    setSettleTarget(null);
    setReadyTrackIds({});
    setUserGestureStack(true);
    updateOverlayRect();
    setStack({
      current: currentVisual,
      next: nextVisual,
      prev: prevVisual,
    });
  }, [currentVisual, nextVisual, prevVisual, updateOverlayRect, x]);

  const snapBack = useCallback(() => {
    activeAnimation.current?.stop();
    animationToken.current += 1;
    const token = animationToken.current;
    const controls = animate(x, 0, { duration: 0.42, ease: SNAP_EASE, type: "tween" });
    activeAnimation.current = controls;
    void controls.then(() => {
      if (animationToken.current !== token) return;
      activeAnimation.current = null;
      setDragDirection(null);
      setOverlayRect(null);
      setUserGestureStack(false);
      setStack(null);
    });
  }, [x]);

  const cancelTapForContextMenu = useCallback(() => {
    tapMoved.current = true;
    if (!dragDirection && !committing && stackVisible) clearStack();
  }, [clearStack, committing, dragDirection, stackVisible]);

  useEffect(() => {
    if (!settleTarget || current?.id === settleTarget.track.id) return;
    clearStack();
  }, [clearStack, current?.id, settleTarget]);

  const commit = useCallback(
    (direction: Exclude<SwipeDirection, null>, release?: { fromProgress: number }) => {
      if (committing) return;
      const action = direction === "next" ? next : skipPrev;
      const targetVisual = direction === "next" ? activeStack.next : activeStack.prev;
      if (!targetVisual) {
        snapBack();
        return;
      }

      if (clearTimer.current != null) window.clearTimeout(clearTimer.current);
      // This gesture animates the switch itself — tag the target so the store
      // change it triggers isn't double-animated by the external-switch effect.
      selfSwitchRef.current = targetVisual.track.id;
      setCommitting(true);
      setHandoffFading(false);
      const target = direction === "next" ? -exitTravel / DRAG_GAIN : exitTravel / DRAG_GAIN;
      // Swiper auto-complete (PRD Phase 4 / Transition Driver): glide only the
      // REMAINING distance from where the finger let go, scaled to that distance
      // (full duration × remaining) — release near the end finishes quickly, an
      // early release glides longer. NOT velocity-scaled: a fast release would
      // collapse to the floor and flash the whole remaining distance in ~one frame
      // (QA). A non-drag commit (no release ctx) keeps the full fixed duration.
      const durationSec = release
        ? remainingDurationMs({
            baseMs: COMMIT_DURATION_SEC * 1000,
            fromProgress: release.fromProgress,
            toProgress: 1,
          }) / 1000
        : COMMIT_DURATION_SEC;
      activeAnimation.current?.stop();
      animationToken.current += 1;
      const token = animationToken.current;
      const controls = animate(x, target, {
        duration: durationSec,
        ease: COMMIT_EASE,
        type: "tween",
      });
      activeAnimation.current = controls;
      void controls.then(async () => {
        if (animationToken.current !== token) return;
        activeAnimation.current = null;
        // Keep the release tween transform-only. Switching the player updates
        // the stage/background and may load media, so defer it until the cover
        // has parked at the exit.
        await action().catch(() => undefined);
        if (animationToken.current !== token) return;
        // Hand off to the settled card while the strip stays parked at the exit
        // (the outgoing cover has already faded to 0 there). Resetting x now
        // would snap the *old* card back to centre — that's the flash. The reset
        // is deferred to the handoff below, once only the settled card renders.
        setSettleTarget(targetVisual);
        setCommitting(false);
        setDragDirection(null);
      });
    },
    [activeStack.next, activeStack.prev, committing, exitTravel, next, skipPrev, snapBack, x],
  );

  // Animate a switch the stage *didn't* initiate (transport buttons, Q-E,
  // auto-advance, queue clicks). Same coverflow as a drag/wheel commit, only the
  // store has already moved — so this just plays the visual catch-up.
  const playProgrammaticSwitch = useCallback(
    (direction: Exclude<SwipeDirection, null>, outgoing: VisualTrack, incoming: VisualTrack) => {
      activeAnimation.current?.stop();
      if (clearTimer.current != null) {
        window.clearTimeout(clearTimer.current);
        clearTimer.current = null;
      }
      if (handoffTimer.current != null) {
        window.clearTimeout(handoffTimer.current);
        handoffTimer.current = null;
      }
      animationToken.current += 1;
      const token = animationToken.current;
      x.set(0);
      setReadyTrackIds({});
      setUserGestureStack(false);
      setHandoffFading(false);
      setSettleTarget(null);
      setCommitting(true);
      setDragDirection(direction);
      updateOverlayRect();
      setStack({
        current: outgoing,
        next: direction === "next" ? incoming : null,
        prev: direction === "prev" ? incoming : null,
      });
      const target = direction === "next" ? -exitTravel / DRAG_GAIN : exitTravel / DRAG_GAIN;
      const controls = animate(x, target, {
        duration: SWITCH_DURATION_SEC,
        ease: COMMIT_EASE,
        type: "tween",
      });
      activeAnimation.current = controls;
      void controls.then(() => {
        if (animationToken.current !== token) return;
        activeAnimation.current = null;
        setSettleTarget(incoming);
        setCommitting(false);
        setDragDirection(null);
      });
    },
    [exitTravel, updateOverlayRect, x],
  );

  useEffect(() => {
    const prev = switchSnapRef.current;
    const newId = current?.id;
    if (!foregroundVisible) {
      if (stackVisible) clearStack();
      switchSnapRef.current = {
        id: newId,
        index: currentIndex,
        nextId: nextTrack?.id,
        prevId: prevTrack?.id,
        track: current,
      };
      return;
    }
    if (prev?.id && newId && prev.id !== newId) {
      if (selfSwitchRef.current === newId) {
        // Our own drag/wheel commit is already animating this exact switch.
        selfSwitchRef.current = null;
      } else if (Date.now() - lastSwitchAtRef.current < coverflowBurstSkipMs) {
        // Rapid switch (held Q/E at the 200ms transport cap): a 0.62s coverflow slide
        // can't finish before the next switch, so animating it would tear down and
        // restart every frame, leaving the cover lagging the current track ("封面对不上").
        // Tear down any running slide and let the base MediaStage cover + Pixi
        // background crossfade carry it directly — both are bounded to the transport
        // cap, so they keep up with held Q/E. (No more backlight suppression.)
        lastSwitchAtRef.current = Date.now();
        if (stackVisible) clearStack();
      } else {
        lastSwitchAtRef.current = Date.now();
        const outgoing = makeVisualTrack(prev.track, preloadedCoverUrls);
        const incoming = makeVisualTrack(current, preloadedCoverUrls);
        // Skip the slide if the incoming cover isn't loaded yet (a jump to a
        // far track) — the plain crossfade handles those; we never deadlock the
        // handoff waiting on a cover that the overlay can't show. `trackHasCover`
        // (not coverBlobId) so a streamed track — which has a remote cover but no
        // preloaded blob the overlay can paint — falls through to the base
        // MediaStage crossfade instead of sliding a bare title card then popping
        // the cover in (the "title flash then cover" on every switch).
        const incomingReady =
          !!incoming && (!trackHasCover(incoming.track) || !!incoming.initialCoverUrl);
        if (outgoing && incoming && incomingReady) {
          let direction: Exclude<SwipeDirection, null>;
          if (newId === prev.nextId) direction = "next";
          else if (newId === prev.prevId) direction = "prev";
          else direction = currentIndex >= prev.index ? "next" : "prev";
          playProgrammaticSwitch(direction, outgoing, incoming);
        }
      }
    }
    switchSnapRef.current = {
      id: newId,
      index: currentIndex,
      nextId: nextTrack?.id,
      prevId: prevTrack?.id,
      track: current,
    };
  }, [
    current,
    currentIndex,
    nextTrack?.id,
    prevTrack?.id,
    preloadedCoverUrls,
    playProgrammaticSwitch,
    clearStack,
    foregroundVisible,
    stackVisible,
    coverflowBurstSkipMs,
  ]);

  useEffect(() => {
    if (!settleTarget || handoffFading || current?.id !== settleTarget.track.id) return;
    if (
      trackHasCover(settleTarget.track) &&
      (!preloadedCoverUrls[settleTarget.track.id] ||
        !readyTrackIds[settleTarget.track.id] ||
        !stageCoverSettledForCurrent ||
        // Wait until the BASE stage has actually painted the committed cover (the base
        // lags — its displayTrack only updates at the store commit / slide end). Without
        // this the overlay could fade while the base still showed the old cover = the
        // "cover flashes black ~0.5s after release". (No deadlock: the same cover that
        // loaded for the overlay (readyTrackIds) loads for the base — same cache.)
        baseCoverShownId !== settleTarget.track.id)
    ) {
      return;
    }
    if (handoffTimer.current != null) window.clearTimeout(handoffTimer.current);
    const token = animationToken.current;
    const settleMs = trackHasCover(settleTarget.track) ? COVER_READY_SETTLE_MS : 0;
    handoffTimer.current = window.setTimeout(() => {
      if (animationToken.current !== token) return;
      // Only the settled card is on screen now (centre-pinned, x-independent),
      // so parking the strip back at 0 is invisible — no old-cover snap.
      x.set(0);
      setHandoffFading(true);
      clearTimer.current = window.setTimeout(() => {
        if (animationToken.current !== token) return;
        setStack(null);
        setSettleTarget(null);
        setHandoffFading(false);
        setOverlayRect(null);
        clearTimer.current = null;
      }, HANDOFF_DURATION_SEC * 1000);
      handoffTimer.current = null;
    }, settleMs);
    return () => {
      if (handoffTimer.current != null) {
        window.clearTimeout(handoffTimer.current);
        handoffTimer.current = null;
      }
    };
  }, [
    baseCoverShownId,
    current?.id,
    handoffFading,
    preloadedCoverUrls,
    readyTrackIds,
    stageCoverSettledForCurrent,
    settleTarget,
    x,
  ]);

  // Snapshot the latest callbacks/state so the native (passive:false) wheel
  // listener below can read them without being re-attached every render.
  wheelState.current = {
    beginGesture,
    commit,
    committing,
    dragDirection,
    exitTravel,
    handoffFading,
    setDragDirection,
    settleTarget,
    snapBack,
    width,
    x,
  };

  // Horizontal trackpad / wheel swipe drives the very same coverflow commit as a
  // drag. A wheel gesture has no pointerup, so it ends on a short debounce: past
  // the commit threshold it switches (animation and all) and swallows the
  // momentum tail; short of it, it snaps back.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const finishWheel = () => {
      wheelEndTimer.current = null;
      const s = wheelState.current;
      if (s && wheelEngaged.current && !wheelCommitted.current) s.snapBack();
      wheelEngaged.current = false;
      wheelCommitted.current = false;
      wheelAccum.current = 0;
    };

    const onWheel = (e: WheelEvent) => {
      const s = wheelState.current;
      if (!s) return;
      // Vertical-dominant wheels stay scrolls — leave the page alone.
      if (e.deltaX === 0 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      // Claim the horizontal swipe (no page scroll / history back-swipe).
      e.preventDefault();
      if (wheelEndTimer.current != null) window.clearTimeout(wheelEndTimer.current);
      wheelEndTimer.current = window.setTimeout(finishWheel, WHEEL_END_MS);
      // Already switched on this swipe → swallow the momentum tail.
      if (wheelCommitted.current) return;
      // A switch is already running (pointer drag or an earlier swipe) → ignore.
      if (!wheelEngaged.current && (s.committing || s.settleTarget || s.handoffFading)) return;

      const maxX = s.exitTravel / DRAG_GAIN;
      const delta = -e.deltaX * WHEEL_GAIN;
      if (!wheelEngaged.current) {
        // Wait for a decisive amount of travel before showing the strip.
        wheelAccum.current += delta;
        if (Math.abs(wheelAccum.current) < WHEEL_ENGAGE_PX) return;
        wheelEngaged.current = true;
        s.beginGesture();
        s.x.set(Math.max(-maxX, Math.min(maxX, wheelAccum.current)));
      } else {
        s.x.set(Math.max(-maxX, Math.min(maxX, s.x.get() + delta)));
      }

      const value = s.x.get();
      if (value < -8 && s.dragDirection !== "next") s.setDragDirection("next");
      if (value > 8 && s.dragDirection !== "prev") s.setDragDirection("prev");
      const commitDistance = Math.min(
        MAX_COMMIT_DISTANCE,
        Math.max(MIN_COMMIT_DISTANCE, s.width * COMMIT_FRACTION),
      );
      if (Math.abs(value) >= commitDistance) {
        wheelCommitted.current = true;
        s.commit(value < 0 ? "next" : "prev");
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const overlayPortalTarget =
    typeof document !== "undefined"
      ? (containerRef.current?.closest("main") ?? document.body)
      : null;
  // Hide the base only during the ACTIVE drag/slide. Once the switch has COMMITTED
  // (settleTarget set) keep the base visible + centred (x:0 below) UNDER the still-
  // opaque overlay, so its already-decoded cover is painted and never evicted — then
  // the overlay fades into an identical base (no re-decode = no commit flash). The
  // overlay covers it throughout the settle, and x:0 keeps it aligned (no 重影).
  const baseHidden = stackActive && !handoffFading && !settleTarget;
  const stackOverlay =
    foregroundVisible && stackActive && overlayRect && overlayPortalTarget
      ? createPortal(
          <motion.div
            aria-hidden
            animate={{ opacity: handoffFading ? 0 : 1 }}
            className="pointer-events-none fixed z-20 overflow-visible [perspective:1200px] [transform-style:preserve-3d]"
            initial={false}
            style={{
              ...coverAppearanceVars,
              clipPath: `inset(${overlayRect.clipTopInset}px -100vw ${overlayRect.clipBottomInset}px -100vw)`,
              height: overlayRect.height,
              left: overlayRect.left,
              top: overlayRect.top,
              width: overlayRect.width,
            }}
            transition={{ duration: HANDOFF_DURATION_SEC, ease: "easeOut" }}
          >
            {settleTarget ? (
              // Once settled, only the new cover is on screen — the coverflow
              // cards (incl. the outgoing one) are gone, so nothing stacks under it.
              <SettleCard
                coverEffect={coverEffect}
                onReady={markVisualReady}
                visual={liveStackVisual(settleTarget) ?? settleTarget}
              />
            ) : (
              <>
                <CoverflowCard
                  card={prevCard}
                  coverEffect={coverEffect}
                  label="card-prev"
                  onReady={markVisualReady}
                  visual={liveStackVisual(activeStack.prev)}
                  zClass={dragDirection === "prev" ? "z-30" : "z-0"}
                />
                <CoverflowCard
                  card={nextCard}
                  coverEffect={coverEffect}
                  label="card-next"
                  onReady={markVisualReady}
                  visual={liveStackVisual(activeStack.next)}
                  zClass={dragDirection === "next" ? "z-30" : "z-0"}
                />
                <CoverflowCard
                  card={currentCard}
                  coverEffect={coverEffect}
                  coverHasBacklight
                  label="card-current"
                  onReady={markVisualReady}
                  visual={liveStackVisual(activeStack.current)}
                  zClass="z-20"
                />
              </>
            )}
          </motion.div>,
          overlayPortalTarget,
        )
      : null;
  // The cover cross-fades through the handoff, but the (translucent) title/author
  // pills must NOT — two copies fading over each other darken the background. So
  // the base owns the identity the moment the swipe settles; it's hidden only
  // while the overlay's moving coverflow identity is on screen (active drag).
  const identityHidden = stackActive && !settleTarget && !handoffFading;

  // Trace the handoff state machine so a copy-trace can anchor WHEN the base hides
  // (drag-start: baseHidden flips true → the overlay's cold card must paint to fill
  // the gap) and WHEN the commit hands back (settle set → base must repaint before
  // the overlay fades). Correlate the timestamps here with the `nowplaying.cover`
  // paint lines (each carries its label + elapsedMs) to read the flash window.
  // One line per transition — not per frame — so it's cheap and lands in copy-trace.
  // biome-ignore lint/correctness/useExhaustiveDependencies: derived values are logged, state inputs are the deps
  useEffect(() => {
    log.debug("nowplaying.swipe", "state", {
      dragDir: dragDirection ?? "none",
      committing,
      settle: settleTarget?.track.id ?? "none",
      handoffFading,
      baseHidden,
      baseShown: baseCoverShownId ?? "none",
    });
  }, [dragDirection, committing, settleTarget, handoffFading, stack, baseCoverShownId]);

  return (
    <>
      {/* `data-no-drag`: the stage is a mouse-swipe surface (motion `drag="x"`),
          so it must opt out of the Now Playing window-drag region (both shells). */}
      <div
        data-no-drag
        className={cn("flex flex-col gap-2", className)}
        style={coverAppearanceVars}
        onContextMenuCapture={cancelTapForContextMenu}
      >
        <div
          ref={setStageRef}
          className="relative w-full overflow-visible [perspective:1200px] album-cover-radius"
        >
          <motion.div
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
                !dragDirection &&
                !committing &&
                Date.now() - start.t < 400 &&
                Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10;
              if (!dragDirection && !committing && stackVisible) clearStack();
              if (isTap) onTap?.();
            }}
            onDrag={(_, info) => {
              tapMoved.current = true;
              // Begin the (frozen-endpoint) Transition the moment a real drag
              // commits to a direction — captures from = current cover, to = the
              // revealed neighbour. Only a pointer drag reaches here, so button/
              // keyboard switches never begin one (the controller handles those).
              if (info.offset.x < -8 && dragDirection !== "next") {
                setDragDirection("next");
                beginTransition(
                  currentVisual?.initialCoverUrl ?? null,
                  nextVisual?.initialCoverUrl ?? null,
                  // from = the color the border shows NOW (the live settled accent);
                  // to = the neighbour's resolvable cover accent. The window-border
                  // driver interpolates these by the shared transitionProgress.
                  {
                    from: getVisualizerCoverColorRgb() ?? trackBorderRgb(current),
                    to: trackBorderRgb(nextTrack),
                  },
                );
              }
              if (info.offset.x > 8 && dragDirection !== "prev") {
                setDragDirection("prev");
                beginTransition(
                  currentVisual?.initialCoverUrl ?? null,
                  prevVisual?.initialCoverUrl ?? null,
                  {
                    from: getVisualizerCoverColorRgb() ?? trackBorderRgb(current),
                    to: trackBorderRgb(prevTrack),
                  },
                );
              }
            }}
            onDragEnd={(_, info) => {
              // Release decision through the shared Transition Driver so the drag
              // converges on the same math the background already reads (Phase 4).
              // Direction from the drag sign; commit if dragged past the distance
              // threshold OR a fling matches the drag. The threshold is the same px
              // value as before, normalized to the same `step` space as the shared
              // progress — so WHETHER it commits is unchanged; only the path is
              // unified and the release auto-completes the remaining glide (commit).
              const dir = resolveDragDirection(info.offset.x, DRAG_DIRECTION_DEADZONE);
              if (!dir) {
                snapBack();
                return;
              }
              const commitDistancePx = Math.min(
                MAX_COMMIT_DISTANCE,
                Math.max(MIN_COMMIT_DISTANCE, width * COMMIT_FRACTION),
              );
              // Decision uses the raw POINTER distance (offset.x) — commit if the
              // finger dragged past the threshold, same rule as before.
              const willCommit = shouldCommitRelease({
                direction: dir,
                flingVelocity: COMMIT_VELOCITY,
                progress: manualProgress(info.offset.x * DRAG_GAIN, step),
                threshold: manualProgress(commitDistancePx * DRAG_GAIN, step),
                velocity: info.velocity.x,
              });
              // Auto-complete distance uses the actual VISUAL position (x.get(),
              // the elastic-constrained motion value the cards + background ride) —
              // NOT offset.x. With dragConstraints 0 + elastic, the pointer travels
              // far past the constraint while x barely moves, so offset.x reads
              // "almost done" → remaining ~0 → ~0ms → an instant snap (QA). x.get()
              // is how far the cover really slid, so the glide covers what's left.
              const releaseProgress = manualProgress(x.get() * DRAG_GAIN, step);
              if (willCommit) commit(dir, { fromProgress: releaseProgress });
              else snapBack();
            }}
            aria-label={`${t("player.previous")} / ${t("player.next")}`}
            className="relative z-10 w-full touch-pan-y cursor-grab select-none overflow-visible active:cursor-grabbing album-cover-radius [&_*]:select-none [&_img]:pointer-events-none"
            style={{
              // Centre the base during the settle so it aligns with the (centred,
              // x-independent) settled overlay card — otherwise it'd sit at the slide
              // offset and double-image. The slide `x` only drives it during the drag.
              x: settleTarget ? 0 : x,
              opacity: baseHidden ? 0 : 1,
              willChange: "transform",
            }}
          >
            <MediaStage
              coverBacklightEnabled={foregroundVisible && !baseHidden && baseCoverBacklightEnabled}
              coverBacklightFadeIn
              onCoverReady={setBaseCoverShownId}
            />
          </motion.div>
        </div>
        {/* Title + author travel with the cover during an active drag (handled by
            the overlay coverflow cards); the moment the swipe settles, the base
            takes the identity back so it doesn't cross-fade and darken. */}
        {current && (
          <div
            style={{
              opacity: identityHidden ? 0 : 1,
              // Only let the artist/album links take clicks while at rest (the
              // identity stays in the DOM but invisible during a swipe).
              pointerEvents: identityHidden ? "none" : "auto",
            }}
          >
            <StageIdentity track={current} />
          </div>
        )}
      </div>
      {stackOverlay}
    </>
  );
}

type SwipeDirection = "next" | "prev" | null;
type StageOverlayRect = {
  clipBottomInset: number;
  clipTopInset: number;
  height: number;
  left: number;
  top: number;
  width: number;
};
type VisualTrack = { initialCoverUrl: string | null; track: Track };
type SwipeCoverEffect = {
  backlightOpacity: number;
  mode: "shadow" | "backlight" | "off";
};
type SwipeStack = {
  current: VisualTrack | null;
  next: VisualTrack | null;
  prev: VisualTrack | null;
};
type SwitchSnapshot = {
  id: string | undefined;
  index: number;
  nextId: string | undefined;
  prevId: string | undefined;
  track: Track | undefined;
};
type WheelState = {
  beginGesture: () => void;
  commit: (direction: Exclude<SwipeDirection, null>) => void;
  committing: boolean;
  dragDirection: SwipeDirection;
  exitTravel: number;
  handoffFading: boolean;
  setDragDirection: (direction: SwipeDirection) => void;
  settleTarget: VisualTrack | null;
  snapBack: () => void;
  width: number;
  x: MotionValue<number>;
};

type CoverflowMotion = ReturnType<typeof useCoverflowCard>;

/**
 * One cover in the swipe strip plus its title/author block. The whole card gets
 * the same coverflow transform so the cover, glow, and identity move as one.
 */
function CoverflowCard({
  card,
  coverEffect,
  coverHasBacklight,
  label,
  onReady,
  visual,
  zClass,
}: {
  card: CoverflowMotion;
  coverEffect: SwipeCoverEffect;
  coverHasBacklight?: boolean;
  label?: string;
  onReady?: (trackId: string) => void;
  visual: VisualTrack | null;
  zClass: string;
}) {
  if (!visual) return null;
  return (
    <motion.div
      className={cn(SWIPE_CARD_BASE, coverEffect.mode === "shadow" && "album-cover-shadow", zClass)}
      style={{
        x: card.screenX,
        opacity: card.coverOpacity,
        rotateY: card.rotateY,
        scale: card.scale,
        transformOrigin: "center center",
        transformStyle: "preserve-3d",
      }}
    >
      <TrackVisual
        backlightInitial={false}
        coverEffect={coverEffect}
        hasBacklight={coverHasBacklight}
        key={visual.track.id}
        label={label}
        onReady={onReady}
        visual={visual}
      />
      <div className="pointer-events-none absolute inset-x-0 top-full z-[80] mt-2">
        <StageIdentity track={visual.track} />
      </div>
    </motion.div>
  );
}

/**
 * The settled (incoming) cover, flat dead-centre under the fade-out. Only the
 * cover — the title/author come from the base layer (which is already showing
 * the new track by now), so the translucent pills never cross-fade and darken.
 */
function SettleCard({
  coverEffect,
  onReady,
  visual,
}: {
  coverEffect: SwipeCoverEffect;
  onReady?: (trackId: string) => void;
  visual: VisualTrack;
}) {
  return (
    <motion.div
      className={cn(SWIPE_CARD_BASE, coverEffect.mode === "shadow" && "album-cover-shadow", "z-40")}
      initial={false}
    >
      <TrackVisual
        backlightInitial
        coverEffect={coverEffect}
        key={visual.track.id}
        label="card-settle"
        onReady={onReady}
        visual={visual}
      />
    </motion.div>
  );
}

/** Poweramp-style title + author pills shown directly below the stage cover. */
function StageIdentity({ track }: { track: Track }) {
  return (
    <div className="relative z-[90] flex w-full min-w-0 flex-col items-start gap-1.5">
      <div className="w-fit min-w-0 max-w-full overflow-hidden rounded-full border border-white/10 bg-black/55 px-4 py-1.5 shadow-lg">
        <AutoScrollText className="text-2xl font-bold tracking-normal text-white">
          {track.title}
        </AutoScrollText>
      </div>
      <div className="w-fit min-w-0 max-w-full overflow-hidden rounded-full border border-white/10 bg-black/50 px-3 py-1 shadow-md">
        <AutoScrollText className="text-base font-semibold text-white/85" staticMode="clip">
          <StageSubtitle track={track} />
        </AutoScrollText>
      </div>
    </div>
  );
}

/**
 * Artist(s) · album subtitle with each entity clickable — opens it in the
 * library (tab 2). Falls back to the plain caption/note/title line for generated
 * or untagged tracks that carry no embedded artist/album metadata.
 */
function StageSubtitle({ track }: { track: Track }) {
  const artists = trackArtists(track);
  const album = trackAlbum(track);
  if (artists.length === 0 && !album) return <>{trackSubtitle(track)}</>;
  return (
    <>
      {artists.map((name, index) => (
        <Fragment key={name}>
          {index > 0 && ", "}
          <StageEntityLink onOpen={() => useNavStore.getState().openArtist(name)}>
            {name}
          </StageEntityLink>
        </Fragment>
      ))}
      {artists.length > 0 && album && <span aria-hidden> · </span>}
      {album && (
        <StageEntityLink onOpen={() => useNavStore.getState().openAlbumForTrack(track.id)}>
          {album}
        </StageEntityLink>
      )}
    </>
  );
}

/** A clickable artist/album segment inside the stage subtitle → library (tab 2). */
function StageEntityLink({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="rounded outline-none transition-colors hover:text-primary focus-visible:text-primary"
    >
      {children}
    </button>
  );
}

/**
 * Coverflow motion values for one card in the strip. `offset` is where the card
 * sits relative to centre (0 current, +step next, -step prev); the card's
 * on-screen position drives a symmetric centre-pivot tilt/scale/fade.
 */
function useCoverflowCard(
  visualX: MotionValue<number>,
  offset: number,
  step: number,
  tilt: number,
  sideScale: number,
) {
  const screenX = useTransform(visualX, (value) => value + offset);
  const rotateY = useTransform(screenX, [-step, 0, step], [tilt, 0, -tilt]);
  const scale = useTransform(screenX, [-step, 0, step], [sideScale, 1, sideScale]);
  // Reach 0 right at the exit (|screenX| === step) so the outgoing cover is
  // fully faded by the time the strip parks — no pop, no leftover under the
  // settled card. Side cards still read clearly through the mid-slide.
  const coverOpacity = useTransform(
    screenX,
    [-step, -step * 0.55, 0, step * 0.55, step],
    [0, 0.6, 1, 0.6, 0],
  );
  return { coverOpacity, rotateY, scale, screenX };
}

function TrackVisual({
  backlightInitial = false,
  coverEffect,
  hasBacklight = false,
  label,
  onReady,
  visual,
}: {
  backlightInitial?: boolean;
  coverEffect: SwipeCoverEffect;
  hasBacklight?: boolean;
  /** Diagnostic tag forwarded to CanvasCover so a trace can tell each card's flash apart. */
  label?: string;
  onReady?: (trackId: string) => void;
  visual: VisualTrack;
}) {
  const hasCover = trackHasCover(visual.track);
  const coverUrl = hasCover ? visual.initialCoverUrl : null;
  const shouldLoadBacklight = coverEffect.mode === "backlight" && hasBacklight;
  const backlightUrl = useCoverDerivativeUrl(
    shouldLoadBacklight ? visual.track : undefined,
    "backlight",
    { traceSource: "coverflow:backlight" },
  );

  useEffect(() => {
    if (!hasCover || coverUrl) onReady?.(visual.track.id);
  }, [coverUrl, hasCover, onReady, visual.track.id]);

  const showBacklight = shouldLoadBacklight && !!backlightUrl;

  return coverUrl ? (
    <>
      {showBacklight && (
        <motion.div
          aria-hidden
          initial={backlightInitial ? { opacity: 0 } : false}
          animate={{ opacity: coverEffect.backlightOpacity }}
          transition={{ duration: 0.42, ease: "easeOut" }}
          className="pointer-events-none absolute inset-0 z-0 now-playing-cover-backlight-clip"
        >
          <img
            src={backlightUrl ?? undefined}
            alt=""
            aria-hidden
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={false}
            className="absolute inset-0 size-full object-cover album-cover-radius"
            style={{
              transform: "scale(var(--now-playing-cover-backlight-scale, 1.12))",
              filter: [
                "blur(var(--now-playing-cover-backlight-blur, 20px))",
                "saturate(var(--now-playing-cover-backlight-saturation, 400%))",
              ].join(" "),
            }}
          />
        </motion.div>
      )}
      {/* Canvas cover (decode-off-thread, no DOM <img> = no decode flash) — instant
          (crossfade 0) since a card shows one cover; preloaded covers are already
          decoded by the warm pass, so it paints on its first frame. */}
      <div className="absolute inset-0 z-10 overflow-hidden bg-muted album-cover-radius">
        <CanvasCover coverUrl={coverUrl} crossfadeSec={0} label={label} />
      </div>
    </>
  ) : (
    <div className="absolute inset-0 z-10 overflow-hidden bg-muted album-cover-radius">
      <StageTitleFallback track={visual.track} />
    </div>
  );
}

function makeVisualTrack(
  track: Track | undefined,
  preloadedCoverUrls: Record<string, string>,
): VisualTrack | null {
  // `trackHasCover` (not coverBlobId) so a streamed track's preloaded remote cover
  // flows into the coverflow strip just like a local blob's object URL.
  return track
    ? {
        initialCoverUrl: trackHasCover(track) ? (preloadedCoverUrls[track.id] ?? null) : null,
        track,
      }
    : null;
}

function compactPreloadCandidates(candidates: CoverPreloadCandidate[]): CoverPreloadCandidate[] {
  const seen = new Set<string>();
  const out: CoverPreloadCandidate[] = [];
  for (const candidate of candidates) {
    const track = candidate.track;
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(candidate);
  }
  return out;
}

function measureVerticalClipBounds(el: HTMLElement | null): { bottom: number; top: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let parent = el?.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (
      overflowY !== "auto" &&
      overflowY !== "scroll" &&
      overflowY !== "hidden" &&
      overflowY !== "clip"
    ) {
      continue;
    }
    const rect = parent.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return bottom > top ? { bottom, top } : { bottom: window.innerHeight, top: 0 };
}
