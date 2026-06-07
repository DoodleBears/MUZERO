"use client";

import { motion } from "motion/react";
import { type ReactNode, type UIEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Memory } from "@/db/types";
import {
  MEMORY_TIMELINE_CAROUSEL_INTERVAL_MS,
  MEMORY_TIMELINE_IDLE_DELAY_MS,
  MEMORY_TIMELINE_ITEM_HEIGHT,
  memoryTimelineIndexFromScroll,
  nextIdleMemoryIndex,
  sortMemoryTimelineItems,
} from "@/lib/memory-timeline";
import { cn } from "@/lib/utils";

export interface MemoryTimelineRailItem extends Memory {
  trackTitle?: string;
}

interface MemoryTimelineRailProps {
  carouselIntervalMs?: number;
  className?: string;
  formatCreatedAt: (createdAt: number) => ReactNode;
  idleDelayMs?: number;
  initialScrollTop?: number;
  labels: {
    empty: ReactNode;
    memory: string;
  };
  memories: MemoryTimelineRailItem[];
  onScrollTopChange?: (scrollTop: number) => void;
  timelineItemHeight?: number;
}

export function MemoryTimelineRail({
  carouselIntervalMs = MEMORY_TIMELINE_CAROUSEL_INTERVAL_MS,
  className,
  formatCreatedAt,
  idleDelayMs = MEMORY_TIMELINE_IDLE_DELAY_MS,
  initialScrollTop = 0,
  labels,
  memories,
  onScrollTopChange,
  timelineItemHeight = MEMORY_TIMELINE_ITEM_HEIGHT,
}: MemoryTimelineRailProps) {
  const sortedMemories = useMemo(() => sortMemoryTimelineItems(memories), [memories]);
  const [mode, setMode] = useState<"idle" | "timeline">("idle");
  const [scrollTop, setScrollTop] = useState(Math.max(0, initialScrollTop));
  const [activeIndex, setActiveIndex] = useState(() =>
    memoryTimelineIndexFromScroll(initialScrollTop, timelineItemHeight, sortedMemories.length),
  );
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeMemory = sortedMemories[activeIndex] ?? sortedMemories[0];

  useEffect(() => {
    const nextScrollTop = Math.max(0, initialScrollTop);
    setScrollTop(nextScrollTop);
    setActiveIndex(
      memoryTimelineIndexFromScroll(nextScrollTop, timelineItemHeight, sortedMemories.length),
    );
  }, [initialScrollTop, sortedMemories.length, timelineItemHeight]);

  useEffect(() => {
    if (mode !== "timeline" || !scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollTop;
  }, [mode, scrollTop]);

  useEffect(
    () => () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (mode !== "idle" || sortedMemories.length <= 1) return;
    const interval = setInterval(() => {
      setActiveIndex((current) => nextIdleMemoryIndex(current, sortedMemories.length));
    }, carouselIntervalMs);
    return () => clearInterval(interval);
  }, [carouselIntervalMs, mode, sortedMemories.length]);

  function showTimeline() {
    if (sortedMemories.length === 0) return;
    setMode("timeline");
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setMode("idle"), idleDelayMs);
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const nextScrollTop = Math.max(0, Math.round(event.currentTarget.scrollTop));
    setScrollTop(nextScrollTop);
    setActiveIndex(
      memoryTimelineIndexFromScroll(nextScrollTop, timelineItemHeight, sortedMemories.length),
    );
    onScrollTopChange?.(nextScrollTop);
    showTimeline();
  }

  if (sortedMemories.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/60 p-4 text-center text-muted-foreground text-sm backdrop-blur-sm",
          className,
        )}
        data-testid="memory-timeline-rail"
      >
        {labels.empty}
      </div>
    );
  }

  return (
    <motion.section
      aria-label={labels.memory}
      className={cn(
        "min-h-0 flex-1 overflow-hidden rounded-2xl bg-card/55 p-3 shadow-sm backdrop-blur-sm dark:bg-card/70",
        className,
      )}
      data-mode={mode}
      data-testid="memory-timeline-rail"
      layout
      onFocusCapture={showTimeline}
      onPointerMove={showTimeline}
      onWheel={showTimeline}
    >
      {mode === "idle" && activeMemory ? (
        <motion.article
          animate={{ opacity: 1, y: 0 }}
          className="flex h-full min-h-0 flex-col justify-end rounded-xl border border-border/70 bg-background/75 p-4 shadow-sm"
          data-testid="memory-carousel-card"
          initial={{ opacity: 0.72, y: 8 }}
          key={activeMemory.id}
          transition={{ duration: 0.28 }}
        >
          <div className="mb-3 h-1 w-10 rounded-full bg-primary" />
          <p className="line-clamp-6 whitespace-pre-wrap text-sm leading-6">{activeMemory.note}</p>
          <div className="mt-4 space-y-1 text-muted-foreground text-xs">
            {activeMemory.trackTitle && (
              <div className="truncate font-medium text-foreground/80">
                {activeMemory.trackTitle}
              </div>
            )}
            <time dateTime={new Date(activeMemory.createdAt).toISOString()}>
              {formatCreatedAt(activeMemory.createdAt)}
            </time>
          </div>
        </motion.article>
      ) : (
        <div
          className="h-full overflow-y-auto pr-1"
          data-testid="memory-timeline-scroll"
          onScroll={handleScroll}
          ref={scrollerRef}
        >
          <ol
            className="relative ml-2 min-h-full border-muted-foreground/25 border-l pb-4"
            data-testid="memory-timeline-list"
          >
            {sortedMemories.map((memory, index) => {
              const active = index === activeIndex;
              return (
                <li
                  className="relative pl-5"
                  data-active={active ? "true" : "false"}
                  data-testid={`memory-timeline-item-${memory.id}`}
                  key={memory.id}
                  style={{ minHeight: timelineItemHeight }}
                >
                  <span
                    className={cn(
                      "-left-[5px] absolute top-1 size-2.5 rounded-full border bg-card",
                      active ? "border-primary bg-primary" : "border-muted-foreground/45",
                    )}
                  />
                  <article
                    className={cn(
                      "rounded-xl border p-3 transition-colors",
                      active
                        ? "border-primary/45 bg-background/85"
                        : "border-border/70 bg-background/55",
                    )}
                  >
                    <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-5">
                      {memory.note}
                    </p>
                    <div className="mt-2 space-y-0.5 text-muted-foreground text-xs">
                      {memory.trackTitle && (
                        <div className="truncate font-medium text-foreground/75">
                          {memory.trackTitle}
                        </div>
                      )}
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
