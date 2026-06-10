"use client";

import { ImagePlus, MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { IMAGE_ACCEPT } from "@/lib/file-drop";
import { cn, formatDuration } from "@/lib/utils";

export interface MemoryNoteComposerLabels {
  addPhoto: string;
  cancel: string;
  changePhoto: string;
  notePlaceholder: string;
  photoInput: string;
  removePhoto: (name: string) => string;
  save: string;
  /** Button that pins the memory to the current playback second. */
  pinToTime: string;
  /** Aria for the control that clears the pinned timestamp. */
  clearTime: string;
  /** Aria for the chip showing a pinned timestamp (formatted m:ss). */
  pinnedAt: (time: string) => string;
}

interface MemoryNoteComposerProps {
  autoFocus?: boolean;
  className?: string;
  initialNote?: string;
  /** Existing playback anchor when editing a pinned memory (seconds). */
  initialAtSec?: number;
  /**
   * Non-reactive read of the current playback second; presence enables the
   * "pin to current time" control. Pass a getter (not a value) so the composer
   * doesn't re-render on every timeupdate.
   */
  getCurrentPositionSec?: () => number;
  isSubmitting?: boolean;
  labels: MemoryNoteComposerLabels;
  onCancel?: () => void;
  onPhotoRemove?: () => void;
  onPhotoSelect?: (file: File) => void;
  onSubmit: (note: string, atSec?: number) => void;
  selectedPhotoName?: string;
}

export function MemoryNoteComposer({
  autoFocus = false,
  className,
  initialNote = "",
  initialAtSec,
  getCurrentPositionSec,
  isSubmitting = false,
  labels,
  onCancel,
  onPhotoRemove,
  onPhotoSelect,
  onSubmit,
  selectedPhotoName,
}: MemoryNoteComposerProps) {
  const [draft, setDraft] = useState(initialNote);
  const [atSec, setAtSec] = useState(initialAtSec);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setDraft(initialNote), [initialNote]);
  useEffect(() => setAtSec(initialAtSec), [initialAtSec]);

  function submit() {
    const note = draft.trim();
    if (!note) return;
    onSubmit(note, atSec);
    if (!initialNote) {
      setDraft("");
      setAtSec(undefined);
    }
  }

  function pinToCurrentTime() {
    if (!getCurrentPositionSec) return;
    setAtSec(Math.max(0, Math.floor(getCurrentPositionSec())));
  }

  function selectPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onPhotoSelect?.(file);
  }

  function pastePhoto(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = firstImageFile(Array.from(event.clipboardData.files));
    if (file) onPhotoSelect?.(file);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  }

  return (
    <div className={cn(className)}>
      <Textarea
        autoFocus={autoFocus}
        className="min-h-24 resize-none bg-background text-sm shadow-inner"
        disabled={isSubmitting}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={pastePhoto}
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
          {atSec != null ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-primary text-xs">
              {getCurrentPositionSec ? (
                // Re-click updates the anchor to the current playback second.
                <button
                  aria-label={labels.pinnedAt(formatDuration(atSec))}
                  className="inline-flex items-center gap-1 rounded-full hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={isSubmitting}
                  onClick={pinToCurrentTime}
                  type="button"
                >
                  <MapPin aria-hidden="true" className="size-3" />
                  {formatDuration(atSec)}
                </button>
              ) : (
                <span
                  className="inline-flex items-center gap-1"
                  title={labels.pinnedAt(formatDuration(atSec))}
                >
                  <MapPin aria-hidden="true" className="size-3" />
                  {formatDuration(atSec)}
                </span>
              )}
              <button
                aria-label={labels.clearTime}
                className="rounded-full hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={isSubmitting}
                onClick={() => setAtSec(undefined)}
                type="button"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          ) : getCurrentPositionSec ? (
            <button
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-black/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={isSubmitting}
              onClick={pinToCurrentTime}
              type="button"
            >
              <MapPin aria-hidden="true" className="size-3.5" />
              {labels.pinToTime}
            </button>
          ) : null}
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

function firstImageFile(files: readonly File[]): File | undefined {
  return files.find((file) => file.type.startsWith("image/"));
}
