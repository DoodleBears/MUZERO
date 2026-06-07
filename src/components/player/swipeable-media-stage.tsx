import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { db } from "@/db/muzero-db";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { getCroppedBlob } from "@/lib/image-crop";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { MediaStage } from "./media-stage";
import { StageTitleFallback } from "./stage-title-fallback";

const FALLBACK_WIDTH = 360;
const COMMIT_FRACTION = 0.16;
const MIN_COMMIT_DISTANCE = 44;
const MAX_COMMIT_DISTANCE = 96;
const COMMIT_VELOCITY = 420;
const COMMIT_DURATION_SEC = 1.08;
const HANDOFF_DURATION_SEC = 0.32;
const COVER_READY_SETTLE_MS = 440;
const COMMIT_EASE = [0.22, 1, 0.36, 1] as const;
const SNAP_EASE = [0.25, 1, 0.5, 1] as const;
const EFFECT_TRAVEL_FRACTION = 0.42;
const EXIT_TRAVEL_FRACTION = 0.92;
const DRAG_GAIN = 2;
const SWIPE_CARD_BASE =
  "pointer-events-none absolute inset-0 overflow-hidden rounded-lg bg-muted [backface-visibility:hidden]";

export function SwipeableMediaStage({ className }: { className?: string }) {
  const { t } = useTranslation();
  const x = useMotionValue(0);
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeAnimation = useRef<{ stop: () => void } | null>(null);
  const clearTimer = useRef<number | null>(null);
  const handoffTimer = useRef<number | null>(null);
  const animationToken = useRef(0);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [dragDirection, setDragDirection] = useState<SwipeDirection>(null);
  const [committing, setCommitting] = useState(false);
  const [handoffFading, setHandoffFading] = useState(false);
  const [stack, setStack] = useState<SwipeStack | null>(null);
  const [settleTarget, setSettleTarget] = useState<VisualTrack | null>(null);
  const [readyTrackIds, setReadyTrackIds] = useState<Record<string, true>>({});

  const next = usePlayerStore((s) => s.next);
  const skipPrev = usePlayerStore((s) => s.skipPrev);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const nextTrack = usePlayerStore((s) => s.peekTrack("next"));
  const prevTrack = usePlayerStore((s) => s.peekTrack("prev"));
  const stageCoverUrl = useTrackCoverUrl(current);
  const preloadTracks = useMemo(
    () =>
      compactTracks([
        current,
        prevTrack,
        nextTrack,
        stack?.current?.track,
        stack?.prev?.track,
        stack?.next?.track,
        settleTarget?.track,
      ]),
    [current, nextTrack, prevTrack, settleTarget?.track, stack?.current, stack?.next, stack?.prev],
  );
  const preloadedCoverUrls = usePreloadedCoverUrls(preloadTracks);
  const currentVisual = makeVisualTrack(current, preloadedCoverUrls);
  const nextVisual = makeVisualTrack(nextTrack, preloadedCoverUrls);
  const prevVisual = makeVisualTrack(prevTrack, preloadedCoverUrls);
  const activeStack = stack ?? {
    current: currentVisual,
    next: nextVisual,
    prev: prevVisual,
  };
  const stackVisible = !!stack;
  const stackActive =
    stackVisible && (!!dragDirection || committing || !!settleTarget || handoffFading);

  const travel = Math.max(width, FALLBACK_WIDTH);
  const visualX = useTransform(x, (value) => value * DRAG_GAIN);
  const effectTravel = Math.max(120, Math.min(travel * EFFECT_TRAVEL_FRACTION, 330));
  const exitTravel = Math.max(300, Math.min(travel * EXIT_TRAVEL_FRACTION, 760));
  const sideOffset = Math.min(travel * 0.68, 620);
  const rotateY = useTransform(
    visualX,
    [-effectTravel, 0, effectTravel],
    reducedMotion ? [0, 0, 0] : [40, 0, -40],
  );
  const currentOpacity = useTransform(
    visualX,
    [-exitTravel, -effectTravel * 0.34, 0, effectTravel * 0.34, exitTravel],
    [0, 0.9, 1, 0.9, 0],
  );
  const shadeOpacity = useTransform(visualX, [-effectTravel, 0, effectTravel], [0.28, 0, 0.28]);
  const nextX = useTransform(visualX, [-effectTravel, 0], [0, sideOffset]);
  const nextRotateY = useTransform(visualX, [-effectTravel, 0], reducedMotion ? [0, 0] : [0, -36]);
  const nextOpacity = useTransform(visualX, [-effectTravel * 0.58, -12, 0], [1, 0.56, 0]);
  const nextScale = useTransform(visualX, [-effectTravel, 0], [1, 0.94]);
  const prevX = useTransform(visualX, [0, effectTravel], [-sideOffset, 0]);
  const prevRotateY = useTransform(visualX, [0, effectTravel], reducedMotion ? [0, 0] : [36, 0]);
  const prevOpacity = useTransform(visualX, [0, 12, effectTravel * 0.58], [0, 0.56, 1]);
  const prevScale = useTransform(visualX, [0, effectTravel], [0.94, 1]);

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
      activeAnimation.current?.stop();
      if (clearTimer.current != null) window.clearTimeout(clearTimer.current);
      if (handoffTimer.current != null) window.clearTimeout(handoffTimer.current);
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
    setStack(null);
  }, [x]);

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
    setStack({
      current: currentVisual,
      next: nextVisual,
      prev: prevVisual,
    });
  }, [currentVisual, nextVisual, prevVisual, x]);

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
      setStack(null);
    });
  }, [x]);

  const commit = useCallback(
    (direction: Exclude<SwipeDirection, null>) => {
      if (committing) return;
      const action = direction === "next" ? next : skipPrev;
      const targetVisual = direction === "next" ? activeStack.next : activeStack.prev;
      if (!targetVisual) {
        snapBack();
        return;
      }

      if (clearTimer.current != null) window.clearTimeout(clearTimer.current);
      setCommitting(true);
      setHandoffFading(false);
      void action();
      const target = direction === "next" ? -exitTravel / DRAG_GAIN : exitTravel / DRAG_GAIN;
      activeAnimation.current?.stop();
      animationToken.current += 1;
      const token = animationToken.current;
      const controls = animate(x, target, {
        duration: reducedMotion ? 0.2 : COMMIT_DURATION_SEC,
        ease: COMMIT_EASE,
        type: "tween",
      });
      activeAnimation.current = controls;
      void controls.then(() => {
        if (animationToken.current !== token) return;
        activeAnimation.current = null;
        setSettleTarget(targetVisual);
        setCommitting(false);
        setDragDirection(null);
        x.set(0);
      });
    },
    [
      activeStack.next,
      activeStack.prev,
      committing,
      exitTravel,
      next,
      reducedMotion,
      skipPrev,
      snapBack,
      x,
    ],
  );

  useEffect(() => {
    if (!settleTarget || handoffFading || current?.id !== settleTarget.track.id) return;
    if (
      settleTarget.track.coverBlobId &&
      (!preloadedCoverUrls[settleTarget.track.id] ||
        !readyTrackIds[settleTarget.track.id] ||
        !stageCoverUrl)
    ) {
      return;
    }
    if (handoffTimer.current != null) window.clearTimeout(handoffTimer.current);
    const token = animationToken.current;
    const settleMs = settleTarget.track.coverBlobId ? COVER_READY_SETTLE_MS : 0;
    handoffTimer.current = window.setTimeout(() => {
      if (animationToken.current !== token) return;
      setHandoffFading(true);
      clearTimer.current = window.setTimeout(() => {
        if (animationToken.current !== token) return;
        setStack(null);
        setSettleTarget(null);
        setHandoffFading(false);
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
  }, [current?.id, handoffFading, preloadedCoverUrls, readyTrackIds, settleTarget, stageCoverUrl]);

  return (
    <div className={cn("overflow-visible rounded-lg shadow-md", className)}>
      <div
        ref={containerRef}
        className="relative isolate mx-auto w-full touch-pan-y select-none overflow-visible [perspective:1200px] [transform-style:preserve-3d] [&_*]:select-none [&_img]:pointer-events-none"
      >
        <motion.div
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.24}
          dragMomentum={false}
          onPointerDown={beginGesture}
          onPointerUp={() => {
            if (!dragDirection && !committing && stackVisible) clearStack();
          }}
          onDrag={(_, info) => {
            if (info.offset.x < -8 && dragDirection !== "next") setDragDirection("next");
            if (info.offset.x > 8 && dragDirection !== "prev") setDragDirection("prev");
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
          className="relative z-10 w-full cursor-grab active:cursor-grabbing"
          style={{
            x,
            opacity: stackActive && !handoffFading ? 0 : 1,
            willChange: "transform",
          }}
        >
          <MediaStage className="shadow-none" />
        </motion.div>

        {stackActive && (
          <motion.div
            aria-hidden
            animate={{ opacity: handoffFading ? 0 : 1 }}
            className="pointer-events-none absolute inset-0 z-20 overflow-visible [perspective:1200px] [transform-style:preserve-3d]"
            initial={false}
            transition={{ duration: HANDOFF_DURATION_SEC, ease: "easeOut" }}
          >
            <SideCard
              className={dragDirection === "prev" ? "z-30" : "z-0"}
              style={{
                x: prevX,
                opacity: prevOpacity,
                rotateY: prevRotateY,
                scale: prevScale,
                transformOrigin: "right center",
              }}
              onReady={markVisualReady}
              visual={activeStack.prev}
            />
            <SideCard
              className={dragDirection === "next" ? "z-30" : "z-0"}
              style={{
                x: nextX,
                opacity: nextOpacity,
                rotateY: nextRotateY,
                scale: nextScale,
                transformOrigin: "left center",
              }}
              onReady={markVisualReady}
              visual={activeStack.next}
            />
            <motion.div
              className={cn(SWIPE_CARD_BASE, "z-20")}
              style={{
                x: visualX,
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
              {activeStack.current && (
                <TrackVisual
                  key={activeStack.current.track.id}
                  onReady={markVisualReady}
                  visual={activeStack.current}
                />
              )}
              <motion.div className="absolute inset-0 bg-black" style={{ opacity: shadeOpacity }} />
            </motion.div>
            {settleTarget && (
              <motion.div className={cn(SWIPE_CARD_BASE, "z-40")} initial={false}>
                <TrackVisual
                  key={settleTarget.track.id}
                  onReady={markVisualReady}
                  visual={settleTarget}
                />
              </motion.div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}

type SwipeDirection = "next" | "prev" | null;
type VisualTrack = { initialCoverUrl: string | null; track: Track };
type SwipeStack = {
  current: VisualTrack | null;
  next: VisualTrack | null;
  prev: VisualTrack | null;
};

function SideCard({
  className,
  style,
  visual,
  onReady,
}: {
  className?: string;
  onReady?: (trackId: string) => void;
  style: ComponentProps<typeof motion.div>["style"];
  visual: VisualTrack | null;
}) {
  if (!visual) return null;
  return (
    <motion.div
      className={cn(SWIPE_CARD_BASE, className)}
      style={{ ...style, transformStyle: "preserve-3d" }}
    >
      <TrackVisual key={visual.track.id} onReady={onReady} visual={visual} />
    </motion.div>
  );
}

function TrackVisual({
  onReady,
  visual,
}: {
  onReady?: (trackId: string) => void;
  visual: VisualTrack;
}) {
  const [initialFailed, setInitialFailed] = useState(false);
  const hasCover = !!visual.track.coverBlobId;
  const coverUrl = hasCover && !initialFailed ? visual.initialCoverUrl : null;

  useEffect(() => {
    if (!hasCover || coverUrl) onReady?.(visual.track.id);
  }, [coverUrl, hasCover, onReady, visual.track.id]);

  return coverUrl ? (
    <img
      src={coverUrl}
      alt=""
      draggable={false}
      className="absolute inset-0 size-full object-cover"
      onError={() => setInitialFailed(true)}
    />
  ) : (
    <StageTitleFallback track={visual.track} />
  );
}

function makeVisualTrack(
  track: Track | undefined,
  preloadedCoverUrls: Record<string, string>,
): VisualTrack | null {
  return track
    ? { initialCoverUrl: track.coverBlobId ? (preloadedCoverUrls[track.id] ?? null) : null, track }
    : null;
}

function compactTracks(tracks: Array<Track | undefined>): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const track of tracks) {
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
  }
  return out;
}

type PreloadRequest = {
  coverBlobId: string;
  crop: Track["coverCrop"] | undefined;
  key: string;
  trackId: string;
};

type PreloadedCover = {
  key: string;
  url: string;
};

function usePreloadedCoverUrls(tracks: Track[]): Record<string, string> {
  const settings = useSettings();
  const coverCropped = settings.coverCropped ?? true;
  const entriesRef = useRef<Record<string, PreloadedCover>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const requests = useMemo<PreloadRequest[]>(
    () =>
      tracks.flatMap((track) => {
        if (!track.coverBlobId) return [];
        const crop = coverCropped ? track.coverCrop : undefined;
        const cropKey = crop ? `${crop.x},${crop.y},${crop.width},${crop.height}` : "original";
        return [
          {
            coverBlobId: track.coverBlobId,
            crop,
            key: `${track.id}:${track.coverBlobId}:${cropKey}`,
            trackId: track.id,
          },
        ];
      }),
    [coverCropped, tracks],
  );
  useEffect(() => {
    let alive = true;
    const created: string[] = [];

    const load = async () => {
      const previous = entriesRef.current;
      const nextEntries: Record<string, PreloadedCover> = {};

      for (const request of requests) {
        const reusable = previous[request.trackId];
        if (reusable?.key === request.key) {
          nextEntries[request.trackId] = reusable;
          continue;
        }

        const record = await db.mediaBlobs.get(request.coverBlobId);
        let blob = record?.blob;
        if (!blob) continue;
        if (request.crop) {
          blob = await getCroppedBlob(blob, request.crop, blob.type || "image/jpeg");
        }
        if (!alive) break;
        const url = URL.createObjectURL(blob);
        created.push(url);
        nextEntries[request.trackId] = { key: request.key, url };
      }

      if (!alive) {
        for (const url of created) URL.revokeObjectURL(url);
        return;
      }

      entriesRef.current = nextEntries;
      setUrls(
        Object.fromEntries(
          Object.entries(nextEntries).map(([trackId, entry]) => [trackId, entry.url]),
        ),
      );

      for (const [trackId, entry] of Object.entries(previous)) {
        if (nextEntries[trackId]?.url !== entry.url) URL.revokeObjectURL(entry.url);
      }
    };

    void load();
    return () => {
      alive = false;
    };
  }, [requests]);

  useEffect(() => {
    return () => {
      for (const entry of Object.values(entriesRef.current)) URL.revokeObjectURL(entry.url);
      entriesRef.current = {};
    };
  }, []);

  return urls;
}
