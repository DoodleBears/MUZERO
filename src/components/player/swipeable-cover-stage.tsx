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
  resolveNowPlayingCoverBacklightAppearance,
  resolveNowPlayingCoverEffectMode,
} from "@/lib/album-cover-appearance";
import { coverPaletteFromThumbhash, normalizeCoverPalette } from "@/lib/cover-palette";
import { transitionProgress, useNowPlayingTransition } from "@/lib/now-playing-transition";
import { trackHasCover } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import type { Rgb } from "@/lib/visualizer-color";
import { usePlayerStore } from "@/stores/player-store";
import {
  getVisualizerCoverColorRgb,
  snapVisualizerCoverColor,
} from "@/stores/visualizer-color-store";
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
// Intermediate steps of a multi-step catch-up WALK run faster than the single-step
// switch, so a several-track jump glides through its covers quickly; the final step
// (steps === 1) still uses SWITCH_DURATION_SEC for a soft landing.
const WALK_STEP_DURATION_SEC = 0.28;
// Furthest a programmatic switch will slide rather than snap. Within this many steps the
// coverflow walks through real, in-window covers (no wrong-cover flash); beyond it the
// covers can't preload fast enough and there's nothing loaded to slide through, so it
// snaps. (Raise for more sliding on big queue jumps, at the cost of a longer animation.)
const MAX_SLIDE_STEPS = 8;
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
 * Which single coverflow step moves the visual centre toward `target`, and how many steps
 * away it is — scanning both directions up to `maxSteps` (mode-aware via `stepCenter`, so
 * wrap / shuffle is honoured) and taking the shorter side. `dir: -1` = slide toward next
 * (centre advances), `dir: 1` = toward prev. Returns null when the target is further than
 * `maxSteps` (or unreachable in the current mode) — the caller snaps instead of sliding.
 */
function reachToward(
  stepCenter: (index: number, dir: 1 | -1) => number,
  from: number,
  target: number,
  maxSteps: number,
): { dir: 1 | -1; steps: number } | null {
  let fwd = 0;
  let c = from;
  for (let i = 1; i <= maxSteps; i += 1) {
    c = stepCenter(c, 1);
    if (c === target) {
      fwd = i;
      break;
    }
    if (c === from) break; // wrapped fully without finding it
  }
  let bwd = 0;
  c = from;
  for (let i = 1; i <= maxSteps; i += 1) {
    c = stepCenter(c, -1);
    if (c === target) {
      bwd = i;
      break;
    }
    if (c === from) break;
  }
  if (fwd && (!bwd || fwd <= bwd)) return { dir: -1, steps: fwd };
  if (bwd) return { dir: 1, steps: bwd };
  return null;
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
  // The cover effect (backlight glow / shadow) travels with the overlay coverflow cards
  // during a drag, so it follows the sliding cover instead of sitting on the hidden base
  // (PRD 20260618-backlight-shadow-drag #1). Mirror the base MediaStage's resolution.
  const coverEffectMode = resolveNowPlayingCoverEffectMode(settings.nowPlayingCoverEffectMode);
  const cardBacklightOpacity =
    coverEffectMode === "backlight"
      ? resolveNowPlayingCoverBacklightAppearance(settings).opacity / 100
      : 0;
  const cardCoverShadow = coverEffectMode === "shadow";

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
  // The track id whose coverflow card shows the backlight glow during a gesture/slide —
  // the origin (playing) track, frozen for the gesture so only its card glows (not the
  // preview cards) and the glow follows it as it slides. (PRD 20260618 #1.)
  const [gestureBacklightTrackId, setGestureBacklightTrackId] = useState<string | undefined>(
    undefined,
  );
  const [baseCoverShownId, setBaseCoverShownId] = useState<string | undefined>(undefined);
  // Fresh mirror so commitAndHandoff (a stable callback) can read the latest painted
  // cover without depending on the state.
  const baseCoverShownIdRef = useRef(baseCoverShownId);
  baseCoverShownIdRef.current = baseCoverShownId;
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
  // A burst of programmatic switches arrived faster than the catch-up slide could play.
  // Armed by a catch-up slide's onDone when the centre still trails `currentIndex`; the
  // chain effect then slides the next step. ONLY the catch-up onDone sets it, so a drag /
  // rest recenter (which also bumps centerIndex) never triggers a spurious chained slide.
  const chainPendingRef = useRef(false);
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
  //
  // LAYOUT effect (not passive): at a recentre this MUST publish the new window —
  // retargeting the Pixi sprite offsets — in the SAME paint as the offset-reset layout
  // effect below. As a passive effect it lagged a frame, so the offset reset fired the
  // background's `applyOffset` against the OLD sprite offsets and painted the previous
  // centre's cover at centre for one frame (PRD 20260618-recenter-boundary #2). This
  // runs BEFORE the offset-reset effect (source order), so the sprites carry the new
  // offsets before the reset repositions them.
  useLayoutEffect(() => {
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
    // The backlight glow stays on the PLAYING track's card (the origin) for the whole
    // gesture — it follows that card as it slides; the preview cards dragged toward
    // don't glow. Frozen here so it doesn't jump to the new track when the store
    // commits at settle (the base backlight crossfades the new track in then). (PRD
    // 20260618-backlight-shadow-drag #1: only the current card glows during the drag.)
    const st = usePlayerStore.getState();
    setGestureBacklightTrackId(st.queue[st.currentIndex]?.id);
    // Measure the overlay rect NOW (synchronously), so the coverflow overlay — with the
    // card backlight — renders on the SAME drag-start render that flips `active`.
    // Otherwise `overlayRect` is null for a frame: the base opacity gate (active &&
    // overlayRect) keeps the base cover visible while its backlight is gated off
    // (!active) and the overlay hasn't mounted yet → the base cover shows WITHOUT its
    // glow for a frame = the "drag-start 深黑一下" (PRD 20260618-backlight-shadow-drag #1).
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setOverlayRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    }
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

  // Hand the overlay off to the base, but only once the base has actually PAINTED the
  // committed cover. The base MediaStage is burst-settled AND, for a streamed (R2 /
  // NetEase / …) track, resolves its cover over the NETWORK — so its `coverUrl` is still
  // null when the slide animation lands. A fixed-timer fade would then expose the base
  // while it's holding the PREVIOUS cover: the reported "切下一首时歌名/歌手/音频都更新了，
  // 但封面还停在上一首" on the next-button / Dock-drag external switch (R2 covers; a local
  // cover resolves within a frame so its stale window is invisible). The base-ready
  // effect below clears `awaitingHandoffRef` and fades once `baseCoverShownId` matches.
  // Only a coverless target — whose base may never fire onCoverReady — uses the timed
  // fallback. Shared by the drag settle-commit and the programmatic catch-up slide so
  // every commit path waits the same way the manual drag already did.
  const scheduleCommittedHandoff = useCallback(() => {
    const targetTrack = usePlayerStore.getState().queue[centerIndexRef.current];
    if (handoffTimer.current != null) window.clearTimeout(handoffTimer.current);
    awaitingHandoffRef.current = true;
    if (!(targetTrack && trackHasCover(targetTrack))) {
      handoffTimer.current = window.setTimeout(beginHandoffFade, HANDOFF_FALLBACK_MS);
    } else if (baseCoverShownIdRef.current === targetTrack.id) {
      // The base ALREADY shows the committed cover — a same-track commit (dragged
      // 0→1→0 back to the origin, or a switch onto an already-painted cover). The
      // base-ready effect below won't re-fire (baseCoverShownId doesn't change), so the
      // hand-off would never schedule and `active` would stay stuck true — leaving the
      // backlight (gated on !active) and shadow (base opacity 0) off until the NEXT real
      // switch (PRD 20260618-backlight-shadow-drag #2). Schedule the fade directly.
      awaitingHandoffRef.current = false;
      handoffTimer.current = window.setTimeout(beginHandoffFade, HANDOFF_BASE_SETTLE_MS);
    }
  }, [beginHandoffFade]);

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
    // Snap the visualizer cover color to the committed track NOW, skipping the 650ms
    // settle debounce. The window border / flow read this store; otherwise it keeps the
    // PRE-drag color for ~650ms, so when the drag-color override releases at the hand-off
    // the border flashes back to the old color before settling on the committed one
    // ("松手后 border 闪回起点色再过渡", PRD 20260618-recenter-boundary). Snapping makes the
    // settled color already match where the drag left it. Only for covered targets; the
    // regular debounced path still owns auto-advance / scrub.
    if (targetTrack && trackHasCover(targetTrack)) {
      snapVisualizerCoverColor(
        targetTrack.coverBlobId ?? null,
        trackBorderRgb(targetTrack),
        normalizeCoverPalette(targetTrack.coverPalette),
      );
    }
    scheduleCommittedHandoff();
  }, [scheduleCommittedHandoff]);

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

  // One step of a programmatic catch-up slide (the coverflow chasing the committed
  // `currentIndex`). On landing it recenters; if the committed track is STILL further out
  // — a burst of switches that outran the slide — it arms the chain so the next step
  // slides too (continuous coverflow), otherwise it hands off to the base. Extracted so
  // both the external-switch effect and the chain effect drive the same one-step slide.
  const startCatchUpSlide = useCallback(
    (dir: 1 | -1, durationSec: number) => {
      // The glow follows the FROM-track's card as the overlay slides to the next cover;
      // the base backlight crossfades the new track in at the hand-off. Re-set each step
      // so a chained burst keeps the glow on the current step's origin card (same
      // origin-card rule as a manual drag — PRD 20260618-backlight-shadow-drag #1).
      setGestureBacklightTrackId(usePlayerStore.getState().queue[centerIndexRef.current]?.id);
      setActive(true);
      updateOverlayRect();
      animateOffsetTo(dir, durationSec, () => {
        recenterBy(dir);
        if (usePlayerStore.getState().currentIndex === centerIndexRef.current) {
          // Reached the committed track. Hand off to the base, but WAIT for it to paint
          // the committed cover before fading — exactly like the manual-drag commit. A
          // slow remote/R2 base cover would otherwise be exposed mid-resolve, showing the
          // previous cover under the correct title/audio (the external-switch stale-cover
          // bug). Same-track / already-painted commits fade promptly via the ready check.
          scheduleCommittedHandoff();
        } else {
          // Centre still trails the committed track — let the chain effect slide on.
          chainPendingRef.current = true;
        }
      });
    },
    [animateOffsetTo, recenterBy, scheduleCommittedHandoff, updateOverlayRect],
  );

  // Decide how the coverflow chases the committed `currentIndex` and start the first/next
  // step. Walks toward the target one in-window cover at a time (so every frame shows a
  // real, loaded cover — never a wrong-cover flash); intermediate steps slide fast, the
  // final step lands soft. Beyond MAX_SLIDE_STEPS there's nothing loaded to slide through,
  // so it snaps. Shared by the external-switch effect and the chain effect.
  const slideTowardCommitted = useCallback(() => {
    const store = usePlayerStore.getState();
    const target = store.currentIndex;
    const from = centerIndexRef.current;
    if (target < 0 || target === from) {
      beginHandoffFade();
      return;
    }
    const reach = reachToward(store.stepCenter, from, target, MAX_SLIDE_STEPS);
    if (!reach) {
      // Too far to slide through loaded covers — snap to the committed track (no flash).
      stopAnimation();
      coverWindowOffset.set(0);
      centerIndexRef.current = target;
      setCenterIndex(target);
      closeOverlay();
      return;
    }
    startCatchUpSlide(reach.dir, reach.steps <= 1 ? SWITCH_DURATION_SEC : WALK_STEP_DURATION_SEC);
  }, [beginHandoffFade, closeOverlay, startCatchUpSlide, stopAnimation]);

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
  // click, Dock drag. The store already moved; slide the coverflow to catch up (walking
  // through real covers toward the target, see slideTowardCommitted), or snap if it's
  // further than MAX_SLIDE_STEPS.
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
    // A catch-up slide is still in flight — a rapid BURST of switches. Don't snap: let it
    // finish, then its onDone arms the chain effect to slide the next step, so fast
    // switching stays a continuous coverflow instead of a hard cut. The chain effect reads
    // the LATEST `currentIndex`, so deferring here loses nothing.
    if (activeAnimation.current != null) return;
    slideTowardCommitted();
  }, [currentIndex, slideTowardCommitted]);

  // Continue the walk toward the committed track: once an in-flight slide's recenter has
  // advanced the visual centre (and the deferred offset-reset effect — earlier in source
  // order — has put the offset back at 0), slide the NEXT step. Gated on chainPendingRef,
  // which ONLY a catch-up onDone sets — a drag / rest recenter (which also bumps
  // centerIndex) is inert here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: centerIndex is the run-after-recenter trigger
  useLayoutEffect(() => {
    if (!chainPendingRef.current) return;
    chainPendingRef.current = false;
    if (draggingRef.current) return;
    slideTowardCommitted();
  }, [centerIndex]);

  // At rest, keep the visual centre pinned to the committed track id (a queue edit
  // that shifts indices, or boot). Only when nothing is in flight.
  //
  // `activeAnimation` (a REF) guards alongside `active` (state): on an external switch
  // the layout effect above starts the catch-up slide (setting activeAnimation) AND
  // calls setActive(true), but `active` is still stale-false when THIS passive effect
  // runs in the same commit. Without the ref guard this fired setCenterIndex(currentIndex)
  // mid-slide — recentring the window onto the just-committed track so the slide (aimed
  // for the OLD centre) overshot to the track one further out, then corrected back: the
  // reported "切到下一首时先滑到 2 再回到 1" on a single Dock/button switch (PRD
  // 20260618-recenter-boundary). The layout effect runs before this, so the ref is set.
  useEffect(() => {
    if (active || draggingRef.current || activeAnimation.current != null) return;
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
            // during the hand-off fade. The overlay coverflow cards carry their OWN
            // backlight + shadow (which travel with the sliding cover), so the base —
            // including its backlight — is fully hidden during the drag (PRD
            // 20260618-backlight-shadow-drag #1: backlight follows the cover).
            opacity: active && overlayRect && !handoffFading ? 0 : 1,
            willChange: "transform",
          }}
        >
          <MediaStage
            // ON at rest AND during the hand-off fade (not just after, at closeOverlay).
            // The base backlight is portaled out (not hidden by the base opacity), so it
            // fades IN during the hand-off while the card backlight (still rendered, also
            // fading with the overlay) is on top — a crossfade. The card carries the
            // CORRECT committed-cover glow throughout, covering the brief moment the base's
            // blurred derivative still holds the previous track's image (the "闪回上一张
            // backlight 颜色"); by closeOverlay the derivative has resolved. (PRD
            // 20260618-backlight-shadow-drag #1 commit hand-off.)
            coverBacklightEnabled={foregroundVisible && (!active || handoffFading)}
            // Match the base backlight's fade-IN to the overlay's fade-OUT during the
            // hand-off (same duration + easeOut), so card(1−p) + base(p) sums to a
            // constant glow — the card fading out and the base fading in cancel, no
            // brightness dip (PRD 20260618-backlight-shadow-drag #1: the flicker was a
            // dip because the base fade-in was 420ms vs the overlay's 280ms).
            coverBacklightFadeMs={handoffFading ? HANDOFF_FADE_MS : undefined}
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
              backlightOpacity={cardBacklightOpacity}
              // Only the playing/origin track's card glows (it follows that card as it
              // slides); the preview cards don't. Through the hand-off the origin card
              // keeps glowing + fades with the overlay while the base backlight fades the
              // committed track in — a colour crossfade (PRD 20260618 #1).
              backlightTrackId={active ? gestureBacklightTrackId : undefined}
              coverShadow={cardCoverShadow}
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
