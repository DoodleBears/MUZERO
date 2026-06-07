"use client";

import { Image as ImageIcon, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Memory } from "@/db/types";
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
  labels,
  memories,
  onDeleteMemory,
  onEditMemory,
  onSetCoverFromMemory,
}: MemoryNotesWaterfallProps) {
  const sortedMemories = sortMemoriesForWaterfall(memories);

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
      className={cn("columns-1 gap-3 sm:columns-2 xl:columns-3", className)}
    >
      {leadingItem && <li className="mb-3 break-inside-avoid">{leadingItem}</li>}
      {sortedMemories.map((memory) => (
        <li
          className="mb-3 break-inside-avoid rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md"
          key={memory.id}
        >
          {memory.photoUrl && (
            <img
              alt={labels.photoAlt(memory)}
              className="mb-3 aspect-[4/3] w-full rounded-md object-cover shadow-inner"
              src={memory.photoUrl}
            />
          )}
          <p className="whitespace-pre-wrap text-sm leading-6" data-testid="memory-note-text">
            {memory.note}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs opacity-70">
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
        </li>
      ))}
    </ul>
  );
}

export function sortMemoriesForWaterfall(memories: readonly MemoryNoteView[]): MemoryNoteView[] {
  return memories
    .map((memory, index) => ({ index, memory }))
    .sort((a, b) => b.memory.createdAt - a.memory.createdAt || a.index - b.index)
    .map(({ memory }) => memory);
}
