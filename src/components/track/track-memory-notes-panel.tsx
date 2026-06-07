"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import {
  addMemory,
  deleteMemory,
  getMemoryPhoto,
  listMemories,
  setTrackCoverFromMemory,
  updateMemoryNote,
} from "@/db/repositories";
import type { Memory } from "@/db/types";
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
  labels: TrackMemoryNotesPanelLabels;
  trackId: string;
}

export function TrackMemoryNotesPanel({
  className,
  db = defaultDb,
  formatCreatedAt,
  labels,
  trackId,
}: TrackMemoryNotesPanelProps) {
  const memories = useLiveQuery(() => listMemories(trackId, db), [db, trackId], []);
  const memoryViews = useMemoryNoteViews(memories, db);
  const [editingMemory, setEditingMemory] = useState<MemoryNoteView | undefined>();
  const [isCreating, setIsCreating] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | undefined>();
  const composerKey = editingMemory?.id ?? "new-memory";
  const showComposer = isCreating || Boolean(editingMemory);

  async function submitMemory(note: string) {
    if (editingMemory) {
      await updateMemoryNote(editingMemory.id, note, db);
      setEditingMemory(undefined);
      return;
    }

    await addMemory(
      {
        trackId,
        note,
        photo: photoFile ? { blob: photoFile, mime: photoFile.type || "image/jpeg" } : undefined,
      },
      db,
    );
    setPhotoFile(undefined);
    setIsCreating(false);
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

  const leadingItem = showComposer ? (
    <MemoryNoteComposer
      autoFocus
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
      className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background p-4 text-muted-foreground text-sm transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setIsCreating(true)}
      type="button"
    >
      <Plus aria-hidden="true" className="size-5" />
      <span>{labels.createMemory}</span>
    </button>
  );

  return (
    <MemoryNotesWaterfall
      className={className}
      formatCreatedAt={formatCreatedAt}
      leadingItem={leadingItem}
      labels={labels.waterfall}
      memories={memoryViews}
      onDeleteMemory={removeMemory}
      onEditMemory={editMemory}
      onSetCoverFromMemory={useMemoryPhotoAsCover}
    />
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
