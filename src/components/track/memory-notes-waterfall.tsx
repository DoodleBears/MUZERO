"use client";

import { Pencil, Trash2 } from "lucide-react";
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
}

interface MemoryNotesWaterfallProps {
  className?: string;
  formatCreatedAt: (createdAt: number) => ReactNode;
  labels: MemoryNotesWaterfallLabels;
  memories: MemoryNoteView[];
  onDeleteMemory?: (memory: MemoryNoteView) => void;
  onEditMemory?: (memory: MemoryNoteView) => void;
}

const noteToneClasses = [
  "border-amber-200/80 bg-amber-50/90 text-amber-950 dark:border-amber-300/20 dark:bg-amber-300/12 dark:text-amber-50",
  "border-sky-200/80 bg-sky-50/90 text-sky-950 dark:border-sky-300/20 dark:bg-sky-300/12 dark:text-sky-50",
  "border-rose-200/80 bg-rose-50/90 text-rose-950 dark:border-rose-300/20 dark:bg-rose-300/12 dark:text-rose-50",
  "border-emerald-200/80 bg-emerald-50/90 text-emerald-950 dark:border-emerald-300/20 dark:bg-emerald-300/12 dark:text-emerald-50",
];

export function MemoryNotesWaterfall({
  className,
  formatCreatedAt,
  labels,
  memories,
  onDeleteMemory,
  onEditMemory,
}: MemoryNotesWaterfallProps) {
  const sortedMemories = sortMemoriesForWaterfall(memories);

  if (sortedMemories.length === 0) {
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
      {sortedMemories.map((memory, index) => (
        <li
          className={cn(
            "mb-3 break-inside-avoid rounded-lg border p-3 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md",
            noteToneClasses[index % noteToneClasses.length],
          )}
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
            {(onEditMemory || onDeleteMemory) && (
              <div className="flex items-center gap-1">
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
