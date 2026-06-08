"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion, useMotionValue, useSpring } from "motion/react";
import {
  type ReactNode,
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Memory } from "@/db/types";
import { resolveMemoryFitText } from "@/lib/memory-fit-text";
import {
  MEMORY_TIMELINE_CAROUSEL_INTERVAL_MS,
  MEMORY_TIMELINE_IDLE_DELAY_MS,
  MEMORY_TIMELINE_ITEM_HEIGHT,
  memoryTimelineCarouselIntervalMs,
  memoryTimelineIndexFromOffset,
  nextIdleMemoryIndex,
  sortMemoryTimelineItems,
} from "@/lib/memory-timeline";
import { cn } from "@/lib/utils";

const MEMORY_CAROUSEL_LAYOUT_SETTLE_MS = 460;
const MEMORY_TIMELINE_BOUNDARY_PULL_THRESHOLD = 96;
const MEMORY_TIMELINE_EDGE_PULL_MAX = 56;
const MEMORY_TIMELINE_EDGE_PULL_ARM_MS = 80;
const MEMORY_TIMELINE_EDGE_PULL_RESET_MS = 180;
const MEMORY_TIMELINE_EDGE_PULL_TRANSITION = {
  damping: 30,
  mass: 0.7,
  stiffness: 420,
  type: "spring",
} as const;

export interface MemoryTimelineRailItem extends Memory {
  photoUrl?: string;
}

interface MemoryTimelineRailProps {
  carouselIntervalMs?: number;
  className?: string;
  formatCreatedAt: (createdAt: number) => ReactNode;
  idleDelayMs?: number;
  initialOffset?: number;
  labels: {
    empty: ReactNode;
    memory: string;
  };
  memories: MemoryTimelineRailItem[];
  onOffsetChange?: (offsetPx: number) => void;
  onPullPastEnd?: () => void;
  onPullPastStart?: () => void;
  timelineItemHeight?: number;
}

type TimelineVirtualItem = {
  index: number;
  size: number;
  start: number;
};

export function MemoryTimelineRail({
  carouselIntervalMs = MEMORY_TIMELINE_CAROUSEL_INTERVAL_MS,
  className,
  formatCreatedAt,
  idleDelayMs = MEMORY_TIMELINE_IDLE_DELAY_MS,
  initialOffset = 0,
  labels,
  memories,
  onOffsetChange,
  onPullPastEnd,
  onPullPastStart,
  timelineItemHeight = MEMORY_TIMELINE_ITEM_HEIGHT,
}: MemoryTimelineRailProps) {
  const sortedMemories = useMemo(() => sortMemoryTimelineItems(memories), [memories]);
  const parentRef = useRef<HTMLDivElement | null>(null);
  const edgePullContentRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(() =>
    memoryTimelineIndexFromOffset(initialOffset, timelineItemHeight, sortedMemories.length),
  );
  const [mode, setMode] = useState<"carousel" | "list">("carousel");
  const [scrollOffset, setScrollOffset] = useState(() => Math.max(0, initialOffset));
  const edgePullRaw = useMotionValue(0);
  const edgePull = useSpring(edgePullRaw, MEMORY_TIMELINE_EDGE_PULL_TRANSITION);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const boundaryPullArmTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const boundaryPullResetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const boundaryPullRef = useRef(0);
  const boundaryPullReadyRef = useRef({ bottom: true, top: true });
  const initialMemoryIndex = useMemo(
    () =>
      memoryTimelineIndexFromOffset(
        Math.max(0, initialOffset),
        timelineItemHeight,
        sortedMemories.length,
      ),
    [initialOffset, sortedMemories.length, timelineItemHeight],
  );
  const activeMemory = sortedMemories[activeIndex] ?? sortedMemories[0];

  const rowVirtualizer = useVirtualizer({
    count: sortedMemories.length,
    estimateSize: () => timelineItemHeight,
    getItemKey: (index) => sortedMemories[index]?.id ?? index,
    getScrollElement: () => parentRef.current,
    overscan: 8,
  });
  const measuredVirtualItems = rowVirtualizer.getVirtualItems();
  const virtualItems: TimelineVirtualItem[] =
    measuredVirtualItems.length > 0
      ? measuredVirtualItems
      : sortedMemories.map((_, index) => ({
          index,
          size: timelineItemHeight,
          start: index * timelineItemHeight,
        }));
  const totalSize = Math.max(
    rowVirtualizer.getTotalSize(),
    sortedMemories.length * timelineItemHeight,
  );

  useEffect(() => {
    setActiveIndex(initialMemoryIndex);
    setScrollOffset(Math.max(0, initialOffset));
  }, [initialMemoryIndex, initialOffset]);

  useEffect(() => {
    if (mode !== "carousel" || sortedMemories.length <= 1) return;
    const timeout = setTimeout(
      () => setActiveIndex((current) => nextIdleMemoryIndex(current, sortedMemories.length)),
      memoryTimelineCarouselIntervalMs(activeMemory?.note ?? "", { baseMs: carouselIntervalMs }),
    );
    return () => clearTimeout(timeout);
  }, [activeMemory, carouselIntervalMs, mode, sortedMemories.length]);

  useEffect(
    () => () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (boundaryPullArmTimerRef.current) clearTimeout(boundaryPullArmTimerRef.current);
      if (boundaryPullResetTimerRef.current) clearTimeout(boundaryPullResetTimerRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (mode !== "list") return;
    const element = parentRef.current;
    if (element && Math.abs(element.scrollTop - scrollOffset) > 1) {
      element.scrollTop = scrollOffset;
    }
  }, [mode, scrollOffset]);

  function showList() {
    if (sortedMemories.length === 0) return;
    setMode("list");
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setMode("carousel"), idleDelayMs);
  }

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const nextOffset = Math.max(0, Math.round(element.scrollTop));
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    boundaryPullRef.current = 0;
    setEdgePullValue(0);
    if (boundaryPullArmTimerRef.current) clearTimeout(boundaryPullArmTimerRef.current);
    boundaryPullReadyRef.current = { bottom: false, top: false };
    if (element.scrollTop <= 0) {
      boundaryPullArmTimerRef.current = setTimeout(() => {
        boundaryPullReadyRef.current.top = true;
      }, MEMORY_TIMELINE_EDGE_PULL_ARM_MS);
    } else if (element.scrollTop >= maxScrollTop - 1) {
      boundaryPullArmTimerRef.current = setTimeout(() => {
        boundaryPullReadyRef.current.bottom = true;
      }, MEMORY_TIMELINE_EDGE_PULL_ARM_MS);
    }
    setScrollOffset(nextOffset);
    setActiveIndex(
      memoryTimelineIndexFromOffset(nextOffset, timelineItemHeight, sortedMemories.length),
    );
    showList();
    onOffsetChange?.(nextOffset);
  }

  useEffect(() => {
    if (mode !== "list") return;
    const element = parentRef.current;
    if (!element) return;
    const target = element;

    function onWheel(event: WheelEvent) {
      handleListWheel(target, event);
    }

    target.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => target.removeEventListener("wheel", onWheel, { capture: true });
  });

  function handleListWheel(element: HTMLDivElement, event: WheelEvent) {
    showList();

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const canScroll = maxScrollTop > 1;
    const atTop = element.scrollTop <= 0;
    const atBottom = element.scrollTop >= maxScrollTop - 1;
    const pullingPastTop = canScroll && event.deltaY < 0 && atTop;
    const pullingPastBottom = canScroll && event.deltaY > 0 && atBottom;

    event.stopPropagation();

    if (!pullingPastTop && !pullingPastBottom) {
      boundaryPullRef.current = 0;
      setEdgePullValue(0);
      return;
    }

    event.preventDefault();

    const ready = pullingPastTop
      ? boundaryPullReadyRef.current.top
      : boundaryPullReadyRef.current.bottom;
    if (!ready) return;

    const direction = pullingPastTop ? 1 : -1;
    boundaryPullRef.current += Math.abs(event.deltaY);
    setEdgePullValue(direction * easeMemoryEdgePull(boundaryPullRef.current));
    resetBoundaryPullSoon();

    if (boundaryPullRef.current < MEMORY_TIMELINE_BOUNDARY_PULL_THRESHOLD) return;
    boundaryPullRef.current = 0;
    setEdgePullValue(0);
    if (pullingPastTop) onPullPastStart?.();
    if (pullingPastBottom) onPullPastEnd?.();
  }

  function resetBoundaryPullSoon() {
    if (boundaryPullResetTimerRef.current) clearTimeout(boundaryPullResetTimerRef.current);
    boundaryPullResetTimerRef.current = setTimeout(() => {
      boundaryPullRef.current = 0;
      setEdgePullValue(0);
    }, MEMORY_TIMELINE_EDGE_PULL_RESET_MS);
  }

  function setEdgePullValue(value: number) {
    edgePullRaw.set(value);
    if (edgePullContentRef.current) {
      edgePullContentRef.current.dataset.edgePull = `${Math.round(value)}`;
    }
  }

  if (sortedMemories.length === 0) {
    return (
      <section
        aria-label={labels.memory}
        className={cn("min-h-0 flex-1 rounded-2xl", className)}
        data-testid="memory-timeline-rail"
      />
    );
  }

  return (
    <motion.section
      aria-label={labels.memory}
      className={cn("min-h-0 flex-1 overflow-hidden rounded-2xl", className)}
      data-mode={mode}
      data-testid="memory-timeline-rail"
      layout
      onWheel={showList}
    >
      {mode === "carousel" ? (
        <div className="grid h-full place-items-center p-3" data-testid="memory-carousel-stage">
          <div
            className="grid h-5/6 max-h-full w-5/6 max-w-none"
            data-testid="memory-carousel-card"
            data-transition="exit-wait-layout-ready"
          >
            <AnimatePresence initial={false}>
              {activeMemory && (
                <MemoryCarouselSlide
                  formatCreatedAt={formatCreatedAt}
                  key={activeMemory.id}
                  memory={activeMemory}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      ) : (
        <div
          className="no-scrollbar h-full overflow-y-auto overscroll-none pt-12 pb-32"
          data-offset={scrollOffset}
          data-testid="memory-timeline-list"
          data-virtualized="fixed-size"
          onScroll={onScroll}
          ref={parentRef}
        >
          <motion.div
            className="relative min-h-full"
            data-edge-pull="0"
            ref={edgePullContentRef}
            style={{ height: `${totalSize}px`, y: edgePull }}
          >
            {virtualItems.map((virtualRow) => {
              const memory = sortedMemories[virtualRow.index];
              if (!memory) return null;

              return (
                <div
                  className="absolute top-0 left-0 flex w-full items-stretch"
                  data-index={virtualRow.index}
                  data-testid={`memory-timeline-item-${memory.id}`}
                  key={memory.id}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <article className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-xl border border-border/70 bg-background/55 px-3 py-2 text-left transition-colors">
                    {memory.photoUrl && (
                      <div className="size-16 shrink-0 overflow-hidden rounded-md bg-secondary/50">
                        <img
                          alt=""
                          className="size-full object-contain"
                          data-testid={`memory-timeline-image-${memory.id}`}
                          src={memory.photoUrl}
                        />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className="line-clamp-2 whitespace-pre-wrap break-words text-sm leading-5"
                        data-testid={`memory-timeline-note-${memory.id}`}
                      >
                        {memory.note}
                      </p>
                      <div className="mt-1 text-muted-foreground text-[11px]">
                        <time dateTime={new Date(memory.createdAt).toISOString()}>
                          {formatCreatedAt(memory.createdAt)}
                        </time>
                      </div>
                    </div>
                  </article>
                </div>
              );
            })}
          </motion.div>
        </div>
      )}
    </motion.section>
  );
}

function easeMemoryEdgePull(distance: number) {
  return Math.min(MEMORY_TIMELINE_EDGE_PULL_MAX, distance * 0.45);
}

function MemoryCarouselSlide({
  formatCreatedAt,
  memory,
}: {
  formatCreatedAt: (createdAt: number) => ReactNode;
  memory: MemoryTimelineRailItem;
}) {
  const [mediaReady, setMediaReady] = useState(!memory.photoUrl);
  const [fitReady, setFitReady] = useState(false);
  const [enterReady, setEnterReady] = useState(false);
  const markFitReady = useCallback(() => setFitReady(true), []);
  const markMediaReady = useCallback(() => setMediaReady(true), []);
  const slideReady = mediaReady && fitReady;

  useEffect(() => {
    if (!slideReady) {
      setEnterReady(false);
      return;
    }

    const timeout = setTimeout(() => setEnterReady(true), MEMORY_CAROUSEL_LAYOUT_SETTLE_MS);
    return () => clearTimeout(timeout);
  }, [slideReady]);

  return (
    <motion.article
      animate={
        enterReady
          ? { filter: "blur(0px)", opacity: 1, scale: 1, y: 0 }
          : { filter: "blur(6px)", opacity: 0, scale: 0.985, y: 8 }
      }
      className="col-start-1 row-start-1 flex h-full max-h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-background/80 p-5 text-center shadow-sm backdrop-blur-sm md:p-6"
      data-enter-ready={enterReady ? "true" : "false"}
      data-fade-in="after-fit-layout"
      data-fit-ready={fitReady ? "true" : "false"}
      data-layout-ready={slideReady ? "true" : "false"}
      data-media-ready={mediaReady ? "true" : "false"}
      data-testid="memory-carousel-slide"
      exit={{ filter: "blur(6px)", opacity: 0, scale: 0.985, y: -10 }}
      initial={{ filter: "blur(6px)", opacity: 0, scale: 0.97, y: 12 }}
      style={{ willChange: "opacity, transform, filter" }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-primary" />
      {memory.photoUrl && (
        <img
          alt=""
          className="mb-4 max-h-[min(52vh,24rem)] w-full rounded-lg object-contain"
          data-testid="memory-carousel-image"
          onError={markMediaReady}
          onLoad={markMediaReady}
          src={memory.photoUrl}
        />
      )}
      <MemoryCarouselNote enabled={mediaReady} note={memory.note} onFitLayout={markFitReady} />
      <div className="mt-4 space-y-1 text-muted-foreground text-xs">
        <time dateTime={new Date(memory.createdAt).toISOString()}>
          {formatCreatedAt(memory.createdAt)}
        </time>
      </div>
    </motion.article>
  );
}

function MemoryCarouselNote({
  enabled,
  note,
  onFitLayout,
}: {
  enabled: boolean;
  note: string;
  onFitLayout: () => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [fitText, setFitText] = useState(() => resolveMemoryFitText(note, { height: 0, width: 0 }));

  useLayoutEffect(() => {
    if (!enabled) return;
    const element = boxRef.current;
    if (!element) return;
    const target: HTMLDivElement = element;

    function updateFitText() {
      const width = target.clientWidth;
      const height = target.clientHeight;
      const computedStyle =
        typeof window !== "undefined" ? window.getComputedStyle(target) : undefined;
      setFitText(
        resolveMemoryFitText(note, {
          fontFamily: computedStyle?.fontFamily,
          height,
          width,
        }),
      );
      onFitLayout();
    }

    updateFitText();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateFitText);
      observer.observe(target);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateFitText);
    return () => window.removeEventListener("resize", updateFitText);
  }, [enabled, note, onFitLayout]);

  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      data-testid="memory-carousel-note-box"
      ref={boxRef}
    >
      <p
        className="max-w-full whitespace-pre-wrap break-words text-center font-semibold tracking-normal"
        data-testid="memory-carousel-note"
        style={{
          fontSize: `${fitText.fontSize}px`,
          lineHeight: `${fitText.lineHeight}px`,
        }}
      >
        {note}
      </p>
    </div>
  );
}
