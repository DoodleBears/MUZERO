"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import {
  addMemory,
  deleteMemory,
  getMemoryPhoto,
  listMemories,
  setTrackCoverFromMemory,
  updateMemory,
} from "@/db/repositories";
import type { Memory } from "@/db/types";
import { useShortcutMatcher } from "@/hooks/use-shortcut-matcher";
import { hasModalDialogOpen } from "@/lib/dom-keys";
import { memoryMasonryDefaults } from "@/lib/memory-masonry";
import { MemoryNoteComposer, type MemoryNoteComposerLabels } from "./memory-note-composer";
import {
  MemoryNotesWaterfall,
  type MemoryNotesWaterfallLabels,
  type MemoryNoteView,
} from "./memory-notes-waterfall";

export interface TrackMemoryNotesPanelLabels {
  composer: MemoryNoteComposerLabels;
  createMemory: string;
  waterfall: MemoryNotesWaterfallLabels;
}

interface TrackMemoryNotesPanelProps {
  className?: string;
  db?: MuzeroDB;
  formatCreatedAt: (createdAt: number) => React.ReactNode;
  /** Non-reactive read of the current playback second — enables pin-to-time. */
  getCurrentPositionSec?: () => number;
  labels: TrackMemoryNotesPanelLabels;
  /** Seek the player to an anchored memory's second (when it's the live track). */
  onSeekToMemory?: (memory: MemoryNoteView) => void;
  trackId: string;
}

export function TrackMemoryNotesPanel({
  className,
  db = defaultDb,
  formatCreatedAt,
  getCurrentPositionSec,
  labels,
  onSeekToMemory,
  trackId,
}: TrackMemoryNotesPanelProps) {
  const memories = useLiveQuery(() => listMemories(trackId, db), [db, trackId], []);
  const memoryViews = useMemoryNoteViews(memories, db);
  const [editingMemory, setEditingMemory] = useState<MemoryNoteView | undefined>();
  const [isCreating, setIsCreating] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | undefined>();
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickPhotoFile, setQuickPhotoFile] = useState<File | undefined>();
  const composerKey = editingMemory?.id ?? "new-memory";
  const showComposer = isCreating || Boolean(editingMemory);
  // Quick-add (default T / N) now comes from the configurable registry
  // (memory.quickAdd); held in a ref so the window listener stays stable.
  const matches = useShortcutMatcher();
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target) || hasModalDialogOpen()) return;
      if (!matchesRef.current(event, "memory.quickAdd")) return;
      event.preventDefault();
      setQuickCreateOpen(true);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function submitMemory(note: string, atSec?: number) {
    if (editingMemory) {
      // `null` clears the anchor when the user un-pins while editing.
      await updateMemory(editingMemory.id, { note, atSec: atSec ?? null }, db);
      setEditingMemory(undefined);
      return;
    }

    await addMemory(
      {
        trackId,
        note,
        atSec,
        photo: photoFile ? { blob: photoFile, mime: photoFile.type || "image/jpeg" } : undefined,
      },
      db,
    );
    setPhotoFile(undefined);
    setIsCreating(false);
  }

  async function submitQuickMemory(note: string, atSec?: number) {
    await addMemory(
      {
        trackId,
        note,
        atSec,
        photo: quickPhotoFile
          ? { blob: quickPhotoFile, mime: quickPhotoFile.type || "image/jpeg" }
          : undefined,
      },
      db,
    );
    setQuickPhotoFile(undefined);
    setQuickCreateOpen(false);
  }

  async function removeMemory(memory: MemoryNoteView) {
    await deleteMemory(memory.id, db);
    if (editingMemory?.id === memory.id) setEditingMemory(undefined);
  }

  async function useMemoryPhotoAsCover(memory: MemoryNoteView) {
    await setTrackCoverFromMemory(memory.id, db);
  }

  function editMemory(memory: MemoryNoteView) {
    setIsCreating(false);
    setPhotoFile(undefined);
    setEditingMemory(memory);
  }

  function cancelCompose() {
    setEditingMemory(undefined);
    setIsCreating(false);
    setPhotoFile(undefined);
  }

  function setQuickDialogOpen(open: boolean) {
    setQuickCreateOpen(open);
    if (!open) setQuickPhotoFile(undefined);
  }

  const leadingItem = showComposer ? (
    <MemoryNoteComposer
      className="p-2"
      autoFocus
      getCurrentPositionSec={getCurrentPositionSec}
      initialAtSec={editingMemory?.atSec}
      initialNote={editingMemory?.note}
      key={composerKey}
      labels={labels.composer}
      onCancel={cancelCompose}
      onPhotoRemove={() => setPhotoFile(undefined)}
      onPhotoSelect={editingMemory ? undefined : setPhotoFile}
      onSubmit={submitMemory}
      selectedPhotoName={photoFile?.name}
    />
  ) : (
    <button
      className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/70 bg-card/45 p-4 text-foreground/70 text-sm transition-colors hover:bg-card/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setIsCreating(true)}
      type="button"
    >
      <Plus aria-hidden="true" className="size-5" />
      <span>{labels.createMemory}</span>
    </button>
  );

  return (
    <>
      <MemoryNotesWaterfall
        className={className}
        formatCreatedAt={formatCreatedAt}
        leadingItem={leadingItem}
        leadingItemEstimatedHeight={
          showComposer
            ? memoryMasonryDefaults.leadingComposerHeight
            : memoryMasonryDefaults.leadingCreateHeight
        }
        labels={labels.waterfall}
        memories={memoryViews}
        onDeleteMemory={removeMemory}
        onEditMemory={editMemory}
        onSeekToMemory={onSeekToMemory}
        onSetCoverFromMemory={useMemoryPhotoAsCover}
      />
      <Dialog onOpenChange={setQuickDialogOpen} open={quickCreateOpen}>
        <DialogContent>
          <DialogTitle>{labels.createMemory}</DialogTitle>
          <MemoryNoteComposer
            autoFocus
            getCurrentPositionSec={getCurrentPositionSec}
            labels={labels.composer}
            onCancel={() => setQuickDialogOpen(false)}
            onPhotoRemove={() => setQuickPhotoFile(undefined)}
            onPhotoSelect={setQuickPhotoFile}
            onSubmit={submitQuickMemory}
            selectedPhotoName={quickPhotoFile?.name}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
}

function useMemoryNoteViews(memories: Memory[], db: MuzeroDB): MemoryNoteView[] {
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];

    async function loadPhotos() {
      if (typeof URL.createObjectURL !== "function") {
        setPhotoUrls({});
        return;
      }

      const next: Record<string, string> = {};
      for (const memory of memories) {
        const blob = await getMemoryPhoto(memory, db);
        if (blob && !(blob instanceof Blob)) continue;
        if (!blob || cancelled) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        next[memory.id] = url;
      }
      if (!cancelled) setPhotoUrls(next);
    }

    void loadPhotos();

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [db, memories]);

  return useMemo(
    () => memories.map((memory) => ({ ...memory, photoUrl: photoUrls[memory.id] })),
    [memories, photoUrls],
  );
}
