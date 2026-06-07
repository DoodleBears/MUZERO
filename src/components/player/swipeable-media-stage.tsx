import {
  AnimatePresence,
  animate,
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { trackSubtitle } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { MediaStage } from "./media-stage";

const FALLBACK_WIDTH = 360;
const COMMIT_FRACTION = 0.16;
const MIN_COMMIT_DISTANCE = 44;
const MAX_COMMIT_DISTANCE = 96;
const COMMIT_VELOCITY = 420;
const COMMIT_DURATION_SEC = 1.44;
const COMMIT_EASE = [0.22, 1, 0.36, 1] as const;
const SNAP_EASE = [0.25, 1, 0.5, 1] as const;
const EFFECT_TRAVEL_FRACTION = 0.42;
const EXIT_TRAVEL_FRACTION = 0.92;
const SETTLE_WITH_COVER_DELAY_MS = 720;
const SETTLE_WITHOUT_COVER_DELAY_MS = 220;
const DRAG_GAIN = 2;

export function SwipeableMediaStage({ className }: { className?: string }) {
  const { t } = useTranslation();
  const x = useMotionValue(0);
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const [overlaying, setOverlaying] = useState(false);
  const [dragDirection, setDragDirection] = useState<SwipeDirection>(null);
  const [committing, setCommitting] = useState(false);
  const [settling, setSettling] = useState<SettlingTrack | null>(null);
  const [swipeCurrent, setSwipeCurrent] = useState<SettlingTrack | null>(null);
  const [swipePreview, setSwipePreview] = useState<SwipePreview | null>(null);
  const settleTimer = useRef<number | null>(null);
  const activeAnimation = useRef<{ stop: () => void } | null>(null);
  const animationToken = useRef(0);

  const next = usePlayerStore((s) => s.next);
  const skipPrev = usePlayerStore((s) => s.skipPrev);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const nextTrack = usePlayerStore((s) => s.peekTrack("next"));
  const prevTrack = usePlayerStore((s) => s.peekTrack("prev"));
  const currentCoverUrl = useTrackCoverUrl(current);
  const nextCoverUrl = useTrackCoverUrl(nextTrack);
  const prevCoverUrl = useTrackCoverUrl(prevTrack);
  const overlayVisible =
    overlaying && (!!dragDirection || committing || !!settling) && !!overlayRect;
  const visualNextTrack = swipePreview?.next.track ?? nextTrack;
  const visualNextCoverUrl = swipePreview?.next.coverUrl ?? nextCoverUrl;
  const visualPrevTrack = swipePreview?.prev.track ?? prevTrack;
  const visualPrevCoverUrl = swipePreview?.prev.coverUrl ?? prevCoverUrl;

  const travel = Math.max(width, FALLBACK_WIDTH);
  const visualX = useTransform(x, (value) => value * DRAG_GAIN);
  const effectTravel = Math.max(120, Math.min(travel * EFFECT_TRAVEL_FRACTION, 330));
  const exitTravel = Math.max(300, Math.min(travel * EXIT_TRAVEL_FRACTION, 760));
  const sideOffset = Math.min(travel * 0.68, 620);
  const rotateY = useTransform(
    visualX,
    [-effectTravel, 0, effectTravel],
    reducedMotion ? [0, 0, 0] : [54, 0, -54],
  );
  const currentOpacity = useTransform(
    visualX,
    [-exitTravel, -effectTravel * 0.32, 0, effectTravel * 0.32, exitTravel],
    [0, 0.9, 1, 0.9, 0],
  );
  const shadeOpacity = useTransform(visualX, [-effectTravel, 0, effectTravel], [0.34, 0, 0.34]);
  const nextX = useTransform(visualX, [-effectTravel, 0], [0, sideOffset]);
  const nextRotateY = useTransform(visualX, [-effectTravel, 0], reducedMotion ? [0, 0] : [0, -46]);
  const nextOpacity = useTransform(visualX, [-effectTravel * 0.55, -12, 0], [1, 0.56, 0]);
  const nextScale = useTransform(visualX, [-effectTravel, 0], [1, 0.92]);
  const prevX = useTransform(visualX, [0, effectTravel], [-sideOffset, 0]);
  const prevRotateY = useTransform(visualX, [0, effectTravel], reducedMotion ? [0, 0] : [46, 0]);
  const prevOpacity = useTransform(visualX, [0, 12, effectTravel * 0.55], [0, 0.56, 1]);
  const prevScale = useTransform(visualX, [0, effectTravel], [0.92, 1]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width || FALLBACK_WIDTH);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
      activeAnimation.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!settling || current?.id !== settling.track.id) return;
    if (current.coverBlobId && !currentCoverUrl) return;
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
    const delay = current.coverBlobId ? SETTLE_WITH_COVER_DELAY_MS : SETTLE_WITHOUT_COVER_DELAY_MS;
    settleTimer.current = window.setTimeout(() => {
      setSettling(null);
      setOverlaying(false);
      setSwipeCurrent(null);
      setSwipePreview(null);
      settleTimer.current = null;
    }, delay);
  }, [current, currentCoverUrl, settling]);

  const measureOverlay = useCallback(() => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    setOverlayRect({
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    });
    if (current) setSwipeCurrent({ coverUrl: currentCoverUrl, track: current });
    setSwipePreview({
      next: { coverUrl: nextCoverUrl, track: nextTrack },
      prev: { coverUrl: prevCoverUrl, track: prevTrack },
    });
  }, [current, currentCoverUrl, nextCoverUrl, nextTrack, prevCoverUrl, prevTrack]);

  const clearSwipeLayer = useCallback(() => {
    activeAnimation.current?.stop();
    activeAnimation.current = null;
    animationToken.current += 1;
    setSettling(null);
    setOverlaying(false);
    setSwipeCurrent(null);
    setSwipePreview(null);
    setCommitting(false);
  }, []);

  const beginGesture = useCallback(() => {
    if (settleTimer.current != null) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    activeAnimation.current?.stop();
    activeAnimation.current = null;
    animationToken.current += 1;
    setSettling(null);
    setDragDirection(null);
    setCommitting(false);
    x.set(0);
    measureOverlay();
    setOverlaying(true);
  }, [measureOverlay, x]);

  const snapBack = useCallback(() => {
    activeAnimation.current?.stop();
    animationToken.current += 1;
    const token = animationToken.current;
    const controls = animate(x, 0, { duration: 0.46, ease: SNAP_EASE, type: "tween" });
    activeAnimation.current = controls;
    void controls.then(() => {
      if (animationToken.current !== token) return;
      activeAnimation.current = null;
      setDragDirection(null);
      clearSwipeLayer();
    });
  }, [clearSwipeLayer, x]);

  const commit = useCallback(
    (direction: Exclude<SwipeDirection, null>) => {
      if (committing) return;
      const action = direction === "next" ? next : skipPrev;
      const previewTrack = direction === "next" ? visualNextTrack : visualPrevTrack;
      if (!previewTrack) {
        snapBack();
        return;
      }

      const settleTarget = {
        coverUrl: direction === "next" ? visualNextCoverUrl : visualPrevCoverUrl,
        track: previewTrack,
      };
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
      setOverlaying(true);
      setCommitting(true);
      void action();
      const target = direction === "next" ? -exitTravel / DRAG_GAIN : exitTravel / DRAG_GAIN;
      activeAnimation.current?.stop();
      animationToken.current += 1;
      const token = animationToken.current;
      const controls = animate(x, target, {
        duration: reducedMotion ? 0.22 : COMMIT_DURATION_SEC,
        ease: COMMIT_EASE,
        type: "tween",
      });
      activeAnimation.current = controls;
      void controls.then(() => {
        if (animationToken.current !== token) return;
        activeAnimation.current = null;
        setSettling(settleTarget);
        x.set(0);
        setDragDirection(null);
        setCommitting(false);
      });
    },
    [
      committing,
      next,
      reducedMotion,
      skipPrev,
      snapBack,
      visualNextCoverUrl,
      visualNextTrack,
      visualPrevCoverUrl,
      visualPrevTrack,
      exitTravel,
      x,
    ],
  );

  return (
    <div className={cn("overflow-visible", className)}>
      <div
        ref={containerRef}
        className="relative isolate mx-auto w-full touch-pan-y select-none overflow-visible [perspective:1200px] [transform-style:preserve-3d] [&_*]:select-none [&_img]:pointer-events-none"
      >
        <motion.div
          ref={cardRef}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.24}
          dragMomentum={false}
          onPointerDown={beginGesture}
          onDragStart={beginGesture}
          onPointerUp={() => {
            if (!dragDirection && !committing && !settling) setOverlaying(false);
          }}
          onDrag={(_, info) => {
            if (info.offset.x < -8 && dragDirection !== "next") {
              setDragDirection("next");
            }
            if (info.offset.x > 8 && dragDirection !== "prev") {
              setDragDirection("prev");
            }
          }}
          onDragEnd={(_, info) => {
            const distance = Math.min(
              MAX_COMMIT_DISTANCE,
              Math.max(MIN_COMMIT_DISTANCE, width * COMMIT_FRACTION),
            );
            const wantsNext = info.offset.x < -distance || info.velocity.x < -COMMIT_VELOCITY;
            const wantsPrev = info.offset.x > distance || info.velocity.x > COMMIT_VELOCITY;
            if (wantsNext) {
              commit("next");
            } else if (wantsPrev) {
              commit("prev");
            } else {
              snapBack();
            }
          }}
          aria-label={`${t("player.previous")} / ${t("player.next")}`}
          className="relative z-20 w-full cursor-grab active:cursor-grabbing"
          style={{
            x,
            rotateY,
            opacity: overlayVisible ? 0 : 1,
            transformOrigin:
              dragDirection === "next"
                ? "right center"
                : dragDirection === "prev"
                  ? "left center"
                  : "center center",
            transformStyle: "preserve-3d",
            willChange: "transform",
          }}
        >
          <MediaStage />
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-30 rounded-lg bg-black"
            style={{ opacity: shadeOpacity }}
          />
        </motion.div>
        {overlayVisible &&
          overlayRect &&
          createPortal(
            <FixedSwipeOverlay
              current={current}
              currentCoverUrl={currentCoverUrl}
              dragDirection={dragDirection}
              nextCoverUrl={visualNextCoverUrl}
              nextOpacity={nextOpacity}
              nextRotateY={nextRotateY}
              nextScale={nextScale}
              nextTrack={visualNextTrack}
              nextX={nextX}
              prevCoverUrl={visualPrevCoverUrl}
              prevOpacity={prevOpacity}
              prevRotateY={prevRotateY}
              prevScale={prevScale}
              prevTrack={visualPrevTrack}
              prevX={prevX}
              rect={overlayRect}
              rotateY={rotateY}
              settling={settling}
              currentOpacity={currentOpacity}
              shadeOpacity={shadeOpacity}
              swipeCurrent={swipeCurrent}
              x={visualX}
            />,
            document.body,
          )}
      </div>
    </div>
  );
}

type SwipeDirection = "next" | "prev" | null;
type SettlingTrack = { track: Track; coverUrl: string | null };
type SwipePreview = {
  next: { track: Track | undefined; coverUrl: string | null };
  prev: { track: Track | undefined; coverUrl: string | null };
};
type OverlayRect = { left: number; top: number; width: number; height: number };

function FixedSwipeOverlay({
  current,
  currentCoverUrl,
  dragDirection,
  nextCoverUrl,
  nextOpacity,
  nextRotateY,
  nextScale,
  nextTrack,
  nextX,
  prevCoverUrl,
  prevOpacity,
  prevRotateY,
  prevScale,
  prevTrack,
  prevX,
  rect,
  rotateY,
  settling,
  currentOpacity,
  shadeOpacity,
  swipeCurrent,
  x,
}: {
  current: Track | undefined;
  currentCoverUrl: string | null;
  dragDirection: SwipeDirection;
  nextCoverUrl: string | null;
  nextOpacity: MotionValue<number>;
  nextRotateY: MotionValue<number>;
  nextScale: MotionValue<number>;
  nextTrack: Track | undefined;
  nextX: MotionValue<number>;
  prevCoverUrl: string | null;
  prevOpacity: MotionValue<number>;
  prevRotateY: MotionValue<number>;
  prevScale: MotionValue<number>;
  prevTrack: Track | undefined;
  prevX: MotionValue<number>;
  rect: OverlayRect;
  rotateY: MotionValue<number>;
  settling: SettlingTrack | null;
  currentOpacity: MotionValue<number>;
  shadeOpacity: MotionValue<number>;
  swipeCurrent: SettlingTrack | null;
  x: MotionValue<number>;
}) {
  const visualCurrent = swipeCurrent?.track ?? current;
  const visualCurrentCoverUrl = swipeCurrent ? swipeCurrent.coverUrl : currentCoverUrl;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-[90] overflow-visible [perspective:1200px] [transform-style:preserve-3d]"
      style={{
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width,
      }}
    >
      <PreviewCard
        track={prevTrack}
        coverUrl={prevCoverUrl}
        className={dragDirection === "prev" ? "z-30" : "z-0"}
        style={{
          x: prevX,
          rotateY: prevRotateY,
          opacity: prevOpacity,
          scale: prevScale,
          transformOrigin: "right center",
        }}
      />
      <PreviewCard
        track={nextTrack}
        coverUrl={nextCoverUrl}
        className={dragDirection === "next" ? "z-30" : "z-0"}
        style={{
          x: nextX,
          rotateY: nextRotateY,
          opacity: nextOpacity,
          scale: nextScale,
          transformOrigin: "left center",
        }}
      />
      <motion.div
        className="absolute inset-0 z-20 overflow-hidden rounded-lg bg-muted shadow-md [backface-visibility:hidden]"
        style={{
          x,
          opacity: currentOpacity,
          rotateY,
          transformOrigin:
            dragDirection === "next"
              ? "right center"
              : dragDirection === "prev"
                ? "left center"
                : "center center",
          transformStyle: "preserve-3d",
        }}
      >
        {visualCurrent && <TrackVisual track={visualCurrent} coverUrl={visualCurrentCoverUrl} />}
        <motion.div className="absolute inset-0 bg-black" style={{ opacity: shadeOpacity }} />
      </motion.div>
      <AnimatePresence>
        {settling && (
          <SettlingCard
            key={settling.track.id}
            track={settling.track}
            coverUrl={settling.coverUrl}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PreviewCard({
  track,
  coverUrl,
  className,
  style,
}: {
  track: Track | undefined;
  coverUrl: string | null;
  className?: string;
  style: ComponentProps<typeof motion.div>["style"];
}) {
  if (!track) return null;

  return (
    <motion.div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden rounded-lg bg-muted shadow-md [backface-visibility:hidden]",
        className,
      )}
      style={{ ...style, transformStyle: "preserve-3d" }}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <TrackTitleFallback track={track} />
      )}
      <div className="absolute inset-0 bg-black/10" />
    </motion.div>
  );
}

function TrackVisual({ track, coverUrl }: { track: Track; coverUrl: string | null }) {
  return coverUrl ? (
    <img
      src={coverUrl}
      alt=""
      draggable={false}
      className="absolute inset-0 size-full object-cover"
    />
  ) : (
    <TrackTitleFallback track={track} />
  );
}

function SettlingCard({ track, coverUrl }: { track: Track; coverUrl: string | null }) {
  const liveCoverUrl = useTrackCoverUrl(track);
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="pointer-events-none absolute inset-0 z-40 overflow-hidden rounded-lg bg-muted shadow-md"
    >
      {(liveCoverUrl ?? coverUrl) ? (
        <img
          src={liveCoverUrl ?? coverUrl ?? undefined}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <TrackTitleFallback track={track} />
      )}
    </motion.div>
  );
}

function TrackTitleFallback({ track }: { track: Track }) {
  const subtitle = trackSubtitle(track);
  const showSubtitle = subtitle && subtitle !== track.title;

  return (
    <div className="absolute inset-0 grid place-items-center bg-muted p-7 text-center">
      <div className="max-w-[82%] space-y-2">
        <div className="line-clamp-3 text-balance font-semibold text-foreground text-xl sm:text-2xl">
          {track.title}
        </div>
        {showSubtitle && (
          <div className="line-clamp-2 text-balance font-medium text-muted-foreground text-sm sm:text-base">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
