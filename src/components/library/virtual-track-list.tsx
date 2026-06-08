import { useVirtualizer } from "@tanstack/react-virtual";
import { motion, useMotionValue, useSpring } from "motion/react";
import type { KeyboardEvent } from "react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { deleteTrack as deleteTrackRepo, prependTrackIds, setTrackLiked } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSessions } from "@/hooks/use-app-data";
import { downloadTrackMedia } from "@/lib/download-track";
import { cn } from "@/lib/utils";
import { notify } from "@/stores/notification-store";
import { usePlayerStore } from "@/stores/player-store";
import { TrackRow } from "./track-row";

const TRACK_ROW_HEIGHT = 60;
const TRACK_ROW_BUTTON_SELECTOR = "[data-muzero-track-row-button]";
const TRACK_LIST_EDGE_PULL_THRESHOLD = 96;
const TRACK_LIST_EDGE_PULL_MAX = 56;
const TRACK_LIST_EDGE_PULL_ARM_MS = 80;
const TRACK_LIST_EDGE_PULL_RESET_MS = 180;
const TRACK_LIST_EDGE_PULL_TRANSITION = {
  damping: 30,
  mass: 0.7,
  stiffness: 420,
  type: "spring",
} as const;

/**
 * Virtualized track list (TanStack Virtual). An endless set can grow to hundreds
 * of tracks; only the visible rows mount. The active set's queue plays by index;
 * cross-set lists (search/library) pass `onPlay` to play a specific track.
 */
export function VirtualTrackList({
  tracks,
  onPlay,
  emptyHint,
  className,
  edgePullFeedback = false,
  onPullPastStart,
  onPullPastEnd,
}: {
  tracks: Track[];
  onPlay?: (track: Track, index: number) => void;
  emptyHint?: string;
  /** Extra classes for the scroll element — e.g. `pb-chrome-bottom` to clear the dock. */
  className?: string;
  edgePullFeedback?: boolean;
  onPullPastStart?: () => void;
  onPullPastEnd?: () => void;
}) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const edgePullContentRef = useRef<HTMLDivElement | null>(null);
  const edgePullArmTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const edgePullResetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const edgePullDistanceRef = useRef(0);
  const edgePullReadyRef = useRef({ end: true, start: true });
  const edgePullRaw = useMotionValue(0);
  const edgePull = useSpring(edgePullRaw, TRACK_LIST_EDGE_PULL_TRANSITION);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const queue = usePlayerStore((s) => s.queue);
  const playIndex = usePlayerStore((s) => s.playIndex);
  const sessions = useSessions();

  const currentTrackId = currentIndex >= 0 ? queue[currentIndex]?.id : undefined;
  const handlePlay = onPlay ?? ((_track: Track, index: number) => void playIndex(index));

  const rowVirtualizer = useVirtualizer({
    count: tracks.length,
    estimateSize: () => TRACK_ROW_HEIGHT,
    getItemKey: (index) => tracks[index]?.id ?? index,
    getScrollElement: () => parentRef.current,
    overscan: 8,
  });

  useEffect(
    () => () => {
      if (edgePullArmTimerRef.current) clearTimeout(edgePullArmTimerRef.current);
      if (edgePullResetTimerRef.current) clearTimeout(edgePullResetTimerRef.current);
    },
    [],
  );

  function focusTrackAt(index: number) {
    rowVirtualizer.scrollToIndex(index, { align: "center" });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        parentRef.current
          ?.querySelector<HTMLButtonElement>(
            `${TRACK_ROW_BUTTON_SELECTOR}[data-track-index="${index}"]`,
          )
          ?.focus();
      });
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const button = target?.closest<HTMLButtonElement>(TRACK_ROW_BUTTON_SELECTOR);
    if (!button) return;
    const current = Number(button.dataset.trackIndex);
    if (!Number.isFinite(current)) return;
    const next = event.key === "ArrowDown" ? current + 1 : current - 1;
    if (next < 0 || next >= tracks.length) return;
    event.preventDefault();
    focusTrackAt(next);
  }

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const target = element;

    function onWheel(event: WheelEvent) {
      handleWheel(target, event);
    }

    target.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => target.removeEventListener("wheel", onWheel, { capture: true });
  });

  function handleWheel(element: HTMLDivElement, event: WheelEvent) {
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const canScroll = maxScrollTop > 1;
    const atTop = element.scrollTop <= 0;
    const atBottom = element.scrollTop >= maxScrollTop - 1;
    const pullingPastStart = event.deltaY < 0 && atTop;
    const pullingPastEnd = event.deltaY > 0 && atBottom;
    const handlesStart = canScroll && pullingPastStart && (edgePullFeedback || onPullPastStart);
    const handlesEnd = canScroll && pullingPastEnd && (edgePullFeedback || onPullPastEnd);

    if (!handlesStart && !handlesEnd) {
      edgePullDistanceRef.current = 0;
      setEdgePullValue(0);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const ready = pullingPastStart ? edgePullReadyRef.current.start : edgePullReadyRef.current.end;
    if (!ready) return;

    const direction = pullingPastStart ? 1 : -1;
    edgePullDistanceRef.current += Math.abs(event.deltaY);
    setEdgePullValue(direction * easeEdgePull(edgePullDistanceRef.current));
    resetEdgePullSoon();

    if (edgePullDistanceRef.current < TRACK_LIST_EDGE_PULL_THRESHOLD) return;
    edgePullDistanceRef.current = 0;
    setEdgePullValue(0);
    if (pullingPastStart) onPullPastStart?.();
    if (pullingPastEnd) onPullPastEnd?.();
  }

  function onScroll() {
    const element = parentRef.current;
    if (!element) return;

    edgePullDistanceRef.current = 0;
    setEdgePullValue(0);
    if (edgePullArmTimerRef.current) clearTimeout(edgePullArmTimerRef.current);

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    edgePullReadyRef.current = { end: false, start: false };

    if (element.scrollTop <= 0) {
      edgePullArmTimerRef.current = setTimeout(() => {
        edgePullReadyRef.current.start = true;
      }, TRACK_LIST_EDGE_PULL_ARM_MS);
      return;
    }

    if (element.scrollTop >= maxScrollTop - 1) {
      edgePullArmTimerRef.current = setTimeout(() => {
        edgePullReadyRef.current.end = true;
      }, TRACK_LIST_EDGE_PULL_ARM_MS);
    }
  }

  function resetEdgePullSoon() {
    if (edgePullResetTimerRef.current) clearTimeout(edgePullResetTimerRef.current);
    edgePullResetTimerRef.current = setTimeout(() => {
      edgePullDistanceRef.current = 0;
      setEdgePullValue(0);
    }, TRACK_LIST_EDGE_PULL_RESET_MS);
  }

  function setEdgePullValue(value: number) {
    edgePullRaw.set(value);
    if (edgePullContentRef.current) {
      edgePullContentRef.current.dataset.edgePull = `${Math.round(value)}`;
    }
  }

  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {emptyHint ?? t("track.empty")}
      </div>
    );
  }

  return (
    <div
      className={cn("h-full overflow-y-auto", className)}
      data-testid="virtual-track-list"
      data-virtualized="fixed-size"
      onKeyDown={onKeyDown}
      onScroll={onScroll}
      ref={parentRef}
      role="listbox"
    >
      <motion.div
        className="relative w-full"
        data-edge-pull="0"
        ref={edgePullContentRef}
        style={{ height: `${rowVirtualizer.getTotalSize()}px`, y: edgePull }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const track = tracks[virtualRow.index];
          return (
            <div
              className="absolute left-0 top-0 flex w-full items-center"
              data-index={virtualRow.index}
              data-testid={`virtual-track-row-${track.id}`}
              key={track.id}
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TrackRow
                track={track}
                isCurrent={track.id === currentTrackId}
                listIndex={virtualRow.index}
                sessions={sessions}
                onPlay={() => handlePlay(track, virtualRow.index)}
                onToggleLike={() => void setTrackLiked(track.id, !track.liked)}
                onDelete={() => void deleteTrackRepo(track.id)}
                onDownloadOriginal={() => {
                  void downloadTrackMedia(track, "original").catch((error: unknown) =>
                    notify.error(t("track.downloadFailed"), { error, source: "track-download" }),
                  );
                }}
                onExportWithMetadata={() => {
                  void downloadTrackMedia(track, "withMetadata").catch((error: unknown) =>
                    notify.error(t("track.downloadFailed"), { error, source: "track-download" }),
                  );
                }}
                onAddToSession={(sessionId) => void prependTrackIds(sessionId, [track.id])}
              />
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}

function easeEdgePull(distance: number) {
  return Math.min(TRACK_LIST_EDGE_PULL_MAX, distance * 0.45);
}
