"use client";

import { ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { IMAGE_ACCEPT } from "@/lib/file-drop";
import { cn } from "@/lib/utils";

export interface MemoryNoteComposerLabels {
  addPhoto: string;
  cancel: string;
  changePhoto: string;
  notePlaceholder: string;
  photoInput: string;
  removePhoto: (name: string) => string;
  save: string;
}

interface MemoryNoteComposerProps {
  autoFocus?: boolean;
  className?: string;
  initialNote?: string;
  isSubmitting?: boolean;
  labels: MemoryNoteComposerLabels;
  onCancel?: () => void;
  onPhotoRemove?: () => void;
  onPhotoSelect?: (file: File) => void;
  onSubmit: (note: string) => void;
  selectedPhotoName?: string;
}

export function MemoryNoteComposer({
  autoFocus = false,
  className,
  initialNote = "",
  isSubmitting = false,
  labels,
  onCancel,
  onPhotoRemove,
  onPhotoSelect,
  onSubmit,
  selectedPhotoName,
}: MemoryNoteComposerProps) {
  const [draft, setDraft] = useState(initialNote);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setDraft(initialNote), [initialNote]);

  function submit() {
    const note = draft.trim();
    if (!note) return;
    onSubmit(note);
    if (!initialNote) setDraft("");
  }

  function selectPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onPhotoSelect?.(file);
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm",
        className,
      )}
    >
      <Textarea
        autoFocus={autoFocus}
        className="min-h-24 resize-none bg-background text-sm shadow-inner"
        disabled={isSubmitting}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={labels.notePlaceholder}
        value={draft}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-black/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={isSubmitting}
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            <ImagePlus aria-hidden="true" className="size-3.5" />
            {selectedPhotoName ? labels.changePhoto : labels.addPhoto}
          </button>
          <input
            accept={IMAGE_ACCEPT}
            aria-label={labels.photoInput}
            hidden
            onChange={selectPhoto}
            ref={fileRef}
            type="file"
          />
          {selectedPhotoName && (
            <span className="inline-flex max-w-44 items-center gap-1 rounded-full bg-background/70 px-2 py-1 text-xs">
              <span className="truncate">{selectedPhotoName}</span>
              {onPhotoRemove && (
                <button
                  aria-label={labels.removePhoto(selectedPhotoName)}
                  className="rounded-full hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={isSubmitting}
                  onClick={onPhotoRemove}
                  type="button"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button disabled={isSubmitting} onClick={onCancel} size="sm" variant="outline">
              {labels.cancel}
            </Button>
          )}
          <Button disabled={isSubmitting || !draft.trim()} onClick={submit} size="sm">
            {labels.save}
          </Button>
        </div>
      </div>
    </div>
  );
}
