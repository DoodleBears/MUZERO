"use client";

import { Image as ImageIcon, Pencil, Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { Memory } from "@/db/types";
import {
  layoutMemoryMasonry,
  MEMORY_MASONRY_LEADING_ID,
  memoryMasonryDefaults,
} from "@/lib/memory-masonry";
import { cn } from "@/lib/utils";

export interface MemoryNoteView extends Memory {
  photoUrl?: string;
}

export interface MemoryNotesWaterfallLabels {
  deleteMemory: (memory: MemoryNoteView) => string;
  editMemory: (memory: MemoryNoteView) => string;
  empty: ReactNode;
  photoAlt: (memory: MemoryNoteView) => string;
  setCoverFromMemory?: (memory: MemoryNoteView) => string;
}

interface MemoryNotesWaterfallProps {
  className?: string;
  formatCreatedAt: (createdAt: number) => ReactNode;
  leadingItem?: ReactNode;
  leadingItemEstimatedHeight?: number;
  labels: MemoryNotesWaterfallLabels;
  memories: MemoryNoteView[];
  onDeleteMemory?: (memory: MemoryNoteView) => void;
  onEditMemory?: (memory: MemoryNoteView) => void;
  onSetCoverFromMemory?: (memory: MemoryNoteView) => void;
}

export function MemoryNotesWaterfall({
  className,
  formatCreatedAt,
  leadingItem,
  leadingItemEstimatedHeight = memoryMasonryDefaults.leadingCreateHeight,
  labels,
  memories,
  onDeleteMemory,
  onEditMemory,
  onSetCoverFromMemory,
}: MemoryNotesWaterfallProps) {
  const containerRef = useRef<HTMLUListElement>(null);
  const containerWidth = useElementWidth(containerRef, 672);
  const [photoHeightRatios, setPhotoHeightRatios] = useState<Record<string, number>>({});
  const sortedMemories = sortMemoriesForWaterfall(memories);
  const masonryLayout = useMemo(
    () =>
      layoutMemoryMasonry(
        [
          ...(leadingItem
            ? [{ fixedHeight: leadingItemEstimatedHeight, id: MEMORY_MASONRY_LEADING_ID }]
            : []),
          ...sortedMemories.map((memory) => ({
            hasPhoto: Boolean(memory.photoUrl),
            id: memory.id,
            note: memory.note,
            photoHeightRatio: photoHeightRatios[memory.id],
          })),
        ],
        {
          ...memoryMasonryDefaults,
          containerWidth,
          noteFont: resolveMemoryNoteFont(),
        },
      ),
    [containerWidth, leadingItem, leadingItemEstimatedHeight, photoHeightRatios, sortedMemories],
  );
  const positions = useMemo(
    () => new Map(masonryLayout.items.map((item) => [item.id, item])),
    [masonryLayout.items],
  );

  function setPhotoHeightRatio(memoryId: string, ratio: number) {
    setPhotoHeightRatios((current) => {
      if (current[memoryId] === ratio) return current;
      return { ...current, [memoryId]: ratio };
    });
  }

  if (sortedMemories.length === 0 && !leadingItem) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed p-4 text-muted-foreground text-sm",
          className,
        )}
      >
        {labels.empty}
      </div>
    );
  }

  return (
    <ul
      aria-label={typeof labels.empty === "string" ? labels.empty : undefined}
      className={cn("relative w-full", className)}
      ref={containerRef}
      style={{ height: masonryLayout.containerHeight }}
    >
      {leadingItem && (
        <MemoryMasonryItem
          id={MEMORY_MASONRY_LEADING_ID}
          position={positions.get(MEMORY_MASONRY_LEADING_ID)}
        >
          {leadingItem}
        </MemoryMasonryItem>
      )}
      {sortedMemories.map((memory) => {
        const position = positions.get(memory.id);

        return (
          <MemoryMasonryItem id={memory.id} key={memory.id} position={position}>
            <article className="flex h-full flex-col rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md">
              {memory.photoUrl && (
                <img
                  alt={labels.photoAlt(memory)}
                  className="mb-3 h-auto w-full rounded-md bg-background object-contain shadow-inner"
                  onLoad={(event) => {
                    const { naturalHeight, naturalWidth } = event.currentTarget;
                    if (naturalWidth > 0 && naturalHeight > 0) {
                      setPhotoHeightRatio(memory.id, naturalHeight / naturalWidth);
                    }
                  }}
                  src={memory.photoUrl}
                />
              )}
              <p className="whitespace-pre-wrap text-sm leading-6" data-testid="memory-note-text">
                {memory.note}
              </p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs opacity-70">
                <time dateTime={new Date(memory.createdAt).toISOString()}>
                  {formatCreatedAt(memory.createdAt)}
                </time>
                {((memory.photoBlobId && onSetCoverFromMemory && labels.setCoverFromMemory) ||
                  onEditMemory ||
                  onDeleteMemory) && (
                  <div className="flex items-center gap-1">
                    {memory.photoBlobId && onSetCoverFromMemory && labels.setCoverFromMemory && (
                      <button
                        aria-label={labels.setCoverFromMemory(memory)}
                        className="grid size-7 place-items-center rounded-md hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onSetCoverFromMemory(memory)}
                        type="button"
                      >
                        <ImageIcon aria-hidden="true" className="size-3.5" />
                      </button>
                    )}
                    {onEditMemory && (
                      <button
                        aria-label={labels.editMemory(memory)}
                        className="grid size-7 place-items-center rounded-md hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onEditMemory(memory)}
                        type="button"
                      >
                        <Pencil aria-hidden="true" className="size-3.5" />
                      </button>
                    )}
                    {onDeleteMemory && (
                      <button
                        aria-label={labels.deleteMemory(memory)}
                        className="grid size-7 place-items-center rounded-md hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onDeleteMemory(memory)}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" className="size-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>
          </MemoryMasonryItem>
        );
      })}
    </ul>
  );
}

export function sortMemoriesForWaterfall(memories: readonly MemoryNoteView[]): MemoryNoteView[] {
  return memories
    .map((memory, index) => ({ index, memory }))
    .sort((a, b) => b.memory.createdAt - a.memory.createdAt || a.index - b.index)
    .map(({ memory }) => memory);
}

function MemoryMasonryItem({
  children,
  id,
  position,
}: {
  children: ReactNode;
  id: string;
  position:
    | {
        column: number;
        height: number;
        width: number;
        x: number;
        y: number;
      }
    | undefined;
}) {
  if (!position) return null;

  return (
    <li
      className="absolute transition-[transform,width,height] duration-200 ease-out motion-reduce:transition-none"
      data-column={position.column}
      data-memory-masonry-id={id}
      data-y={position.y}
      style={{
        height: position.height,
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        width: position.width,
      }}
    >
      {children}
    </li>
  );
}

function useElementWidth<TElement extends HTMLElement>(
  ref: RefObject<TElement | null>,
  fallbackWidth: number,
): number {
  const [width, setWidth] = useState(fallbackWidth);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    function updateWidth() {
      setWidth(Math.max(1, element?.clientWidth || fallbackWidth));
    }

    updateWidth();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fallbackWidth, ref]);

  return width;
}

function resolveMemoryNoteFont(): string {
  if (typeof window === "undefined") return memoryMasonryDefaults.noteFont;

  const fontFamily = window.getComputedStyle(document.body).fontFamily;
  return fontFamily ? `14px ${fontFamily}` : memoryMasonryDefaults.noteFont;
}
