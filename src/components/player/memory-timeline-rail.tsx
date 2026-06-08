"use client";

import { AnimatePresence, motion } from "motion/react";
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
import { MemoryNotesWaterfall } from "@/components/track/memory-notes-waterfall";
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
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(() =>
    memoryTimelineIndexFromOffset(initialOffset, timelineItemHeight, sortedMemories.length),
  );
  const [mode, setMode] = useState<"carousel" | "list">("carousel");
  const [scrollOffset, setScrollOffset] = useState(() => Math.max(0, initialOffset));
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    setScrollOffset(nextOffset);
    setActiveIndex(
      memoryTimelineIndexFromOffset(nextOffset, timelineItemHeight, sortedMemories.length),
    );
    showList();
    onOffsetChange?.(nextOffset);
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
      className={cn("relative min-h-0 flex-1 overflow-hidden rounded-2xl", className)}
      data-mode={mode}
      data-testid="memory-timeline-rail"
      layout
      onWheel={showList}
    >
      <div
        aria-hidden={mode !== "carousel"}
        className={cn(
          "absolute inset-0 grid h-full place-items-center p-3 transition-opacity duration-300 ease-out motion-reduce:transition-none",
          mode === "carousel" ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        data-testid="memory-carousel-stage"
        data-visible={mode === "carousel" ? "true" : "false"}
      >
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
      <div
        aria-hidden={mode !== "list"}
        className={cn(
          "no-scrollbar absolute inset-0 h-full overflow-y-auto overscroll-none pt-12 pb-32 transition-opacity duration-300 ease-out motion-reduce:transition-none",
          mode === "list" ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        data-layout="masonry"
        data-offset={scrollOffset}
        data-testid="memory-timeline-list"
        data-visible={mode === "list" ? "true" : "false"}
        onScroll={onScroll}
        ref={parentRef}
      >
        <MemoryNotesWaterfall
          className="min-h-full"
          formatCreatedAt={formatCreatedAt}
          labels={{
            deleteMemory: (memory) => memory.note,
            editMemory: (memory) => memory.note,
            empty: labels.empty,
            photoAlt: () => labels.memory,
          }}
          memories={sortedMemories}
        />
      </div>
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
