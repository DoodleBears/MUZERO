import { useLiveQuery } from "dexie-react-hooks";
import { ImagePlus, Images, Tag, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverCropDialog } from "@/components/track/cover-crop-dialog";
import { LyricsManagerButton } from "@/components/track/lyrics-manager-dialog";
import { TrackMemoryNotesPanel } from "@/components/track/track-memory-notes-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addTrackBackground,
  deleteImageBlob,
  listTrackBackgrounds,
  saveSettings,
  setTrackCover,
  setTrackTags,
} from "@/db/repositories";
import type { CropRect, Track } from "@/db/types";
import { useObjectUrls } from "@/hooks/use-media";
import { IMAGE_ACCEPT } from "@/lib/file-drop";

/**
 * Per-track annotations: tags, memory notes, and an optional cover
 * photo. "Music carries memories" — these are searchable and steer the DJ.
 * `track` is reactive (Dexie useLiveQuery upstream), so tag edits reflect live.
 */
export function AnnotationEditor({ track }: { track: Track }) {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState("");
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [visibleTags, setVisibleTags] = useState(track.tags);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const tagInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setVisibleTags(track.tags);
  }, [track.tags]);

  useEffect(() => {
    if (tagInputOpen) tagInputRef.current?.focus();
  }, [tagInputOpen]);

  function addTag(value = tagInput) {
    const tag = value.trim().toLowerCase();
    if (!tag) return;
    const next = Array.from(new Set([...visibleTags, tag]));
    setVisibleTags(next);
    void setTrackTags(track.id, next);
    setTagInput("");
  }

  function removeTag(tag: string) {
    const next = visibleTags.filter((t) => t !== tag);
    setVisibleTags(next);
    void setTrackTags(track.id, next);
  }

  function onCoverPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setCropFile(file); // open the square cropper before saving
  }

  function saveCover(crop: CropRect) {
    if (!cropFile) return;
    void setTrackCover({
      trackId: track.id,
      blob: cropFile,
      mime: cropFile.type || "image/jpeg",
      crop,
    });
    setCropFile(null);
  }

  return (
    <>
      <div className="mx-auto flex w-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant={tagInputOpen ? "secondary" : "outline"}
            onClick={() => setTagInputOpen(true)}
            aria-label={t("annotation.addTag")}
          >
            <Tag className="size-3.5" />
          </Button>

          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="flex h-8 items-center gap-1 rounded-full border border-border bg-card/55 px-2.5 text-xs"
            >
              #{tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={t("annotation.removeTag", { tag })}
              >
                <X className="size-3 text-muted-foreground hover:text-foreground" />
              </button>
            </span>
          ))}

          {tagInputOpen && (
            <input
              ref={tagInputRef}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                }
                if (e.key === "Escape") {
                  setTagInput("");
                  setTagInputOpen(false);
                }
              }}
              onBlur={() => {
                addTag();
                if (!tagInput.trim()) setTagInputOpen(false);
              }}
              placeholder={t("annotation.addTag")}
              className="h-8 min-w-28 rounded-full border border-border bg-card/55 px-3 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="grid size-8 place-items-center rounded-md border border-border bg-card/55 text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={
                track.coverBlobId ? t("annotation.changeCover") : t("annotation.addCover")
              }
            >
              <ImagePlus className="size-3.5" />
            </button>
            <TrackBackgroundManager trackId={track.id} />
            <LyricsManagerButton track={track} />
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_ACCEPT}
              hidden
              onChange={onCoverPicked}
            />
          </div>
        </div>

        <TrackMemoryNotesPanel
          formatCreatedAt={(createdAt) =>
            new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(createdAt)
          }
          labels={{
            composer: {
              addPhoto: t("annotation.addMemoryPhoto"),
              cancel: t("annotation.cancelMemoryEdit"),
              changePhoto: t("annotation.changeMemoryPhoto"),
              notePlaceholder: t("annotation.notePlaceholder"),
              photoInput: t("annotation.memoryPhotoInput"),
              removePhoto: (name) => t("annotation.removeMemoryPhoto", { name }),
              save: t("annotation.saveMemory"),
            },
            createMemory: t("annotation.createMemory"),
            waterfall: {
              deleteMemory: () => t("annotation.deleteMemory"),
              editMemory: () => t("annotation.editMemory"),
              empty: t("annotation.memoryEmpty"),
              photoAlt: () => t("annotation.memoryPhotoAlt"),
              setCoverFromMemory: () => t("annotation.setMemoryPhotoAsCover"),
            },
          }}
          trackId={track.id}
        />
      </div>
      {cropFile && (
        <CoverCropDialog file={cropFile} onConfirm={saveCover} onCancel={() => setCropFile(null)} />
      )}
    </>
  );
}

function TrackBackgroundManager({ trackId }: { trackId: string }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const backgrounds = useLiveQuery(() => listTrackBackgrounds(trackId), [trackId], []);
  const blobs = useMemo(() => backgrounds.map((bg) => bg.blob), [backgrounds]);
  const urls = useObjectUrls(blobs);

  async function addImages(files: File[]) {
    for (const file of files) {
      await addTrackBackground({
        trackId,
        blob: file,
        mime: file.type || "image/jpeg",
      });
    }
    if (files.length) await saveSettings({ backgroundMode: "slideshow" });
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <button
        type="button"
        className="relative grid size-8 place-items-center rounded-md border border-border bg-card/55 text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
        aria-label={t("background.trackSlideshow")}
      >
        <Images className="size-3.5" />
      </button>
      <DialogContent className="max-h-[min(36rem,calc(100vh-2rem))] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle>{t("background.trackSlideshow")}</DialogTitle>
            <DialogDescription className="mt-2">
              {t("background.trackSlideshowDesc")}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label={t("drop.close")}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </DialogClose>
        </div>

        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            <ImagePlus className="size-3.5" />
            {t("background.addTrackImages")}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            if (files.length) void addImages(files);
          }}
        />

        {backgrounds.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
            {t("background.trackSlideshowEmpty")}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {backgrounds.map((bg, i) => (
              <div
                key={bg.id}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border"
              >
                <img src={urls[i]} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => void deleteImageBlob(bg.id)}
                  aria-label={t("background.removeTrackImage")}
                  className="absolute right-1 top-1 rounded-full bg-background/85 p-1 opacity-100 shadow-sm transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <X className="size-3.5 text-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
