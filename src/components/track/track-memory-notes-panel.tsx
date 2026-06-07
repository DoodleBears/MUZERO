"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import {
  addMemory,
  deleteMemory,
  getMemoryPhoto,
  listMemories,
  updateMemoryNote,
} from "@/db/repositories";
import type { Memory } from "@/db/types";
import { cn } from "@/lib/utils";
import { MemoryNoteComposer, type MemoryNoteComposerLabels } from "./memory-note-composer";
import {
  MemoryNotesWaterfall,
  type MemoryNotesWaterfallLabels,
  type MemoryNoteView,
} from "./memory-notes-waterfall";

export interface TrackMemoryNotesPanelLabels {
  composer: MemoryNoteComposerLabels;
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
  const [photoFile, setPhotoFile] = useState<File | undefined>();
  const composerKey = editingMemory?.id ?? "new-memory";

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
  }

  async function removeMemory(memory: MemoryNoteView) {
    await deleteMemory(memory.id, db);
    if (editingMemory?.id === memory.id) setEditingMemory(undefined);
  }

  function editMemory(memory: MemoryNoteView) {
    setPhotoFile(undefined);
    setEditingMemory(memory);
  }

  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <MemoryNoteComposer
        initialNote={editingMemory?.note}
        key={composerKey}
        labels={labels.composer}
        onCancel={editingMemory ? () => setEditingMemory(undefined) : undefined}
        onPhotoRemove={() => setPhotoFile(undefined)}
        onPhotoSelect={editingMemory ? undefined : setPhotoFile}
        onSubmit={submitMemory}
        selectedPhotoName={photoFile?.name}
      />
      <MemoryNotesWaterfall
        formatCreatedAt={formatCreatedAt}
        labels={labels.waterfall}
        memories={memoryViews}
        onDeleteMemory={removeMemory}
        onEditMemory={editMemory}
      />
    </section>
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
