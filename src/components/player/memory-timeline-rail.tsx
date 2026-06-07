"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
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
  layoutMemoryTimelineItems,
  MEMORY_TIMELINE_CAROUSEL_INTERVAL_MS,
  MEMORY_TIMELINE_IDLE_DELAY_MS,
  MEMORY_TIMELINE_ITEM_HEIGHT,
  memoryTimelineCarouselIntervalMs,
  memoryTimelineIndexFromLayoutOffset,
  memoryTimelineIndexFromOffset,
  memoryTimelineOffsetForLayoutIndex,
  nextIdleMemoryIndex,
  sortMemoryTimelineItems,
} from "@/lib/memory-timeline";
import { cn } from "@/lib/utils";

const MEMORY_CAROUSEL_LAYOUT_SETTLE_MS = 460;

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
  timelineItemHeight?: number;
}

type DragState = {
  startOffset: number;
  startY: number;
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
  timelineItemHeight = MEMORY_TIMELINE_ITEM_HEIGHT,
}: MemoryTimelineRailProps) {
  const sortedMemories = useMemo(() => sortMemoryTimelineItems(memories), [memories]);
  const [mode, setMode] = useState<"idle" | "timeline">("idle");
  const [timelineOffset, setTimelineOffset] = useState(Math.max(0, initialOffset));
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(() =>
    memoryTimelineIndexFromOffset(initialOffset, timelineItemHeight, sortedMemories.length),
  );
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRef = useRef<DragState | null>(null);
  const timelineScrubberRef = useRef<HTMLDivElement | null>(null);
  const timelineLayout = useMemo(
    () =>
      layoutMemoryTimelineItems(
        sortedMemories.map((memory) => ({
          hasPhoto: Boolean(memory.photoUrl),
          id: memory.id,
          note: memory.note,
        })),
        {
          baseItemHeight: timelineItemHeight,
          width: timelineWidth || 360,
        },
      ),
    [sortedMemories, timelineItemHeight, timelineWidth],
  );
  const memoryCollectionKey = useMemo(
    () => sortedMemories.map((memory) => `${memory.trackId}:${memory.id}`).join("\u001f"),
    [sortedMemories],
  );
  const activeCollectionKeyRef = useRef(memoryCollectionKey);
  const initialLayoutIndex = useMemo(
    () => memoryTimelineIndexFromLayoutOffset(Math.max(0, initialOffset), timelineLayout.items),
    [initialOffset, timelineLayout.items],
  );
  const visibleActiveIndex =
    activeCollectionKeyRef.current === memoryCollectionKey ? activeIndex : initialLayoutIndex;
  const activeMemory = sortedMemories[visibleActiveIndex] ?? sortedMemories[0];

  useEffect(() => {
    const nextOffset = Math.max(0, initialOffset);
    activeCollectionKeyRef.current = memoryCollectionKey;
    setTimelineOffset(nextOffset);
    setActiveIndex(initialLayoutIndex);
    setMode("idle");
  }, [initialLayoutIndex, initialOffset, memoryCollectionKey]);

  useEffect(
    () => () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (mode !== "idle" || sortedMemories.length <= 1) return;
    const timeout = setTimeout(
      () => {
        setActiveIndex((current) => {
          const next = nextIdleMemoryIndex(current, sortedMemories.length);
          setTimelineOffset(memoryTimelineOffsetForLayoutIndex(next, timelineLayout.items));
          return next;
        });
      },
      memoryTimelineCarouselIntervalMs(activeMemory?.note ?? "", { baseMs: carouselIntervalMs }),
    );
    return () => clearTimeout(timeout);
  }, [activeMemory, carouselIntervalMs, mode, sortedMemories.length, timelineLayout.items]);

  useLayoutEffect(() => {
    const element = timelineScrubberRef.current;
    if (!element) return;
    const target: HTMLDivElement = element;

    function updateWidth() {
      setTimelineWidth(target.clientWidth);
    }

    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateWidth);
      observer.observe(target);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  function showTimeline() {
    if (sortedMemories.length === 0) return;
    setMode("timeline");
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setMode("idle"), idleDelayMs);
  }

  function setTimelineOffsetFromDrag(offsetPx: number) {
    const maxOffset = memoryTimelineOffsetForLayoutIndex(
      sortedMemories.length - 1,
      timelineLayout.items,
    );
    const nextOffset = Math.min(maxOffset, Math.max(0, Math.round(offsetPx)));
    setTimelineOffset(nextOffset);
    setActiveIndex(memoryTimelineIndexFromLayoutOffset(nextOffset, timelineLayout.items));
    onOffsetChange?.(nextOffset);
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    showTimeline();
    dragRef.current = { startOffset: timelineOffset, startY: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!(event.buttons & 1) || !dragRef.current) return;
    // Drag the timeline, not the playhead: moving it up advances to later memories.
    setTimelineOffsetFromDrag(
      dragRef.current.startOffset - (event.clientY - dragRef.current.startY),
    );
  }

  function onPointerUp(event: PointerEvent<HTMLElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    showTimeline();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (sortedMemories.length === 0) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      setTimelineOffsetFromDrag(
        memoryTimelineOffsetForLayoutIndex(activeIndex - 1, timelineLayout.items),
      );
      showTimeline();
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      setTimelineOffsetFromDrag(
        memoryTimelineOffsetForLayoutIndex(activeIndex + 1, timelineLayout.items),
      );
      showTimeline();
    } else if (event.key === "Home") {
      event.preventDefault();
      setTimelineOffsetFromDrag(0);
      showTimeline();
    } else if (event.key === "End") {
      event.preventDefault();
      setTimelineOffsetFromDrag(
        memoryTimelineOffsetForLayoutIndex(sortedMemories.length - 1, timelineLayout.items),
      );
      showTimeline();
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
      onFocusCapture={showTimeline}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={showTimeline}
    >
      {mode === "idle" && activeMemory ? (
        <div className="grid h-full place-items-center p-3" data-testid="memory-carousel-stage">
          <div
            className="grid h-4/5 max-h-full w-4/5 max-w-none"
            data-testid="memory-carousel-card"
            data-transition="exit-wait-layout-ready"
          >
            <AnimatePresence initial={false}>
              <MemoryCarouselSlide
                formatCreatedAt={formatCreatedAt}
                key={activeMemory.id}
                memory={activeMemory}
              />
            </AnimatePresence>
          </div>
        </div>
      ) : (
        <div
          aria-label={labels.memory}
          aria-valuemax={sortedMemories.length}
          aria-valuemin={1}
          aria-valuenow={visibleActiveIndex + 1}
          className="relative h-full cursor-grab touch-none select-none overflow-hidden outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="memory-timeline-scrubber"
          onKeyDown={onKeyDown}
          ref={timelineScrubberRef}
          role="slider"
          tabIndex={0}
        >
          <ol
            className="absolute top-0 inset-x-4 transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none"
            data-layout="single-column-responsive"
            data-testid="memory-timeline-list"
            style={{
              height: timelineLayout.containerHeight,
              transform: `translateY(calc(50% - ${timelineOffset}px))`,
            }}
          >
            {sortedMemories.map((memory, index) => {
              const active = index === visibleActiveIndex;
              const layoutItem = timelineLayout.items[index] ?? {
                height: timelineItemHeight,
                y: index * timelineItemHeight,
              };
              return (
                <li
                  className="absolute top-0 left-0 flex w-full shrink-0 items-start gap-3"
                  data-active={active ? "true" : "false"}
                  data-testid={`memory-timeline-item-${memory.id}`}
                  key={memory.id}
                  style={{
                    height: layoutItem.height,
                    transform: `translateY(${layoutItem.y}px)`,
                  }}
                >
                  <span
                    className={cn(
                      "mt-5 size-2.5 rounded-full border bg-background shadow-sm transition-colors",
                      active ? "border-primary bg-primary" : "border-muted-foreground/45",
                    )}
                  />
                  <article
                    className={cn(
                      "min-w-0 flex-1 rounded-xl border p-3 text-left transition-colors",
                      active
                        ? "border-primary/45 bg-background/85"
                        : "border-border/70 bg-background/55",
                    )}
                  >
                    {memory.photoUrl && (
                      <img
                        alt=""
                        className="mb-2 max-h-[min(28vh,14rem)] w-full rounded-md object-contain"
                        data-testid={`memory-timeline-image-${memory.id}`}
                        src={memory.photoUrl}
                      />
                    )}
                    <p
                      className="whitespace-pre-wrap break-words text-sm leading-5"
                      data-testid={`memory-timeline-note-${memory.id}`}
                    >
                      {memory.note}
                    </p>
                    <div className="mt-1 space-y-0.5 text-muted-foreground text-[11px]">
                      <time dateTime={new Date(memory.createdAt).toISOString()}>
                        {formatCreatedAt(memory.createdAt)}
                      </time>
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </motion.section>
  );
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
      data-fade-in="after-fit-layout"
      data-enter-ready={enterReady ? "true" : "false"}
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
