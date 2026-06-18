import { ImagePlus, Images, Loader2, UploadCloud, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverCropDialog } from "@/components/track/cover-crop-dialog";
import { Button } from "@/components/ui/button";
import { SetPickerDialog } from "@/components/upload/set-picker-dialog";
import { db } from "@/db/muzero-db";
import {
  addGalleryImage,
  addTrackBackground,
  saveSettings,
  setTrackCover,
} from "@/db/repositories";
import type { CropRect, Track } from "@/db/types";
import { useObjectUrl } from "@/hooks/use-media";
import {
  classifyDrop,
  dragHasFiles,
  filesFromTransfer,
  filesFromTransferDeepInfo,
  summarizeDragItems,
} from "@/lib/file-drop";
import { importProgressPercent } from "@/lib/import-progress";
import { useCoverTargetStore } from "@/stores/cover-target-store";
import { usePlayerStore } from "@/stores/player-store";
import { useUploadTargetStore } from "@/stores/upload-target-store";

type DragInfo = { count: number; allImages: boolean };
type PendingCover = { file: File; track: Track | null };
/** A pasted/dropped image headed straight to the crop step for a selected track. */
type PendingCrop = { file: File; track: Track };
type PendingMedia = { files: File[]; defaultNewSetName?: string };
type ImageAction = "cover" | "background" | "gallery";
type Notice = { kind: "uploaded" | ImageAction | "unsupported"; count: number };

/**
 * App-wide drag-and-drop ingest. Listens at the window so a file can be dropped
 * anywhere on screen (any page): audio/video open a 歌单 picker (unless a set
 * detail page already pinned the target) so the user chooses which set they join
 * — audio and video can share one set — and images open a confirm modal to set
 * the current track's cover. Modeled on ClipCombo's landing-page full-screen drop.
 */
export function GlobalDropZone({
  onMediaUploaded,
}: {
  onMediaUploaded?: (createdSet: boolean) => void;
}) {
  const { t } = useTranslation();
  const isUploading = usePlayerStore((s) => s.isUploading);
  const importProgress = usePlayerStore((s) => s.importProgress);

  const [isDragging, setIsDragging] = useState(false);
  const [dragInfo, setDragInfo] = useState<DragInfo>({ count: 0, allImages: false });
  const [pendingCover, setPendingCover] = useState<PendingCover | null>(null);
  const [pendingCrop, setPendingCrop] = useState<PendingCrop | null>(null);
  const [savingCrop, setSavingCrop] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const dragDepth = useRef(0);

  const handleFiles = useCallback(async (files: File[], opts: { folderName?: string } = {}) => {
    const { media, images, skipped } = classifyDrop(files);
    if (media.length > 0) {
      // Route by the current view's upload target (see upload-target-store):
      // a set detail (`set`) drops straight into that set; everywhere else
      // (`pick` gallery / `active` fallback) asks which 歌单 the media joins.
      // The picker lets audio + video land in the SAME set and never silently
      // strands a drop in a fresh set the user didn't ask for.
      const target = useUploadTargetStore.getState().target;
      if (target.kind === "set") {
        await usePlayerStore.getState().addUploadsToSet(target.setId, media);
        setNotice({ kind: "uploaded", count: media.length });
        return;
      }
      setPendingMedia({ files: media, defaultNewSetName: opts.folderName });
      return;
    }
    if (images.length > 0) {
      // A view showing a selected track (库 所有歌曲 list, artist / album page)
      // publishes it as the cover target — route the image straight to that
      // song's crop step instead of the playing-track-or-gallery fallback.
      const coverTrackId = useCoverTargetStore.getState().trackId;
      if (coverTrackId) {
        const target = await db.tracks.get(coverTrackId);
        if (target) {
          setPendingCrop({ file: images[0], track: target });
          return;
        }
      }
      // Otherwise lock the target to the track playing *now* — playback may
      // advance (a short clip ending) while the modal is open, which would
      // otherwise move the cover onto the wrong track.
      const { queue, currentIndex } = usePlayerStore.getState();
      setPendingCover({
        file: images[0],
        track: currentIndex >= 0 ? (queue[currentIndex] ?? null) : null,
      });
      return;
    }
    if (skipped.length > 0) setNotice({ kind: "unsupported", count: skipped.length });
  }, []);

  // Keep the latest handler in a ref so the window listeners attach once.
  const handleFilesRef = useRef(handleFiles);
  handleFilesRef.current = handleFiles;

  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      if (!dragHasFiles(e.dataTransfer?.types)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragInfo(summarizeDragItems(e.dataTransfer?.items));
      setIsDragging(true);
    }
    function onDragOver(e: DragEvent) {
      if (!dragHasFiles(e.dataTransfer?.types)) return;
      // Prevent the browser from navigating to / opening the dropped file.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
    function onDragLeave(e: DragEvent) {
      if (!dragHasFiles(e.dataTransfer?.types)) return;
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDragging(false);
    }
    function onDrop(e: DragEvent) {
      if (!dragHasFiles(e.dataTransfer?.types)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      // Expand dropped folders into their files. `filesFromTransferDeep` reads the
      // DataTransfer synchronously here (it's invalidated after onDrop returns),
      // then resolves the directory recursion before we ingest.
      void filesFromTransferDeepInfo(e.dataTransfer).then((result) => {
        if (result.files.length > 0) {
          void handleFilesRef.current(result.files, { folderName: result.topLevelFolderName });
        }
      });
    }
    // Ctrl/Cmd+V — paste a copied audio/video/image file, same as a drop. Flash
    // the overlay so it gets the same "recognized" feedback as a drag.
    function onPaste(e: ClipboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
        return; // let text paste into editable fields
      }
      const files = filesFromTransfer(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      setDragInfo(summarizeDragItems(e.clipboardData?.items));
      setIsDragging(true);
      window.setTimeout(() => {
        dragDepth.current = 0;
        setIsDragging(false);
      }, 700);
      void handleFilesRef.current(files);
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  // Auto-dismiss the transient notice.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const overlayIsCover = dragInfo.allImages;

  return (
    <>
      {isDragging && (
        <div
          className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-background/80 backdrop-blur-sm duration-150 animate-in fade-in"
          role="presentation"
        >
          {/* Escape hatch: the overlay is pointer-events-none so a drag can pass
              through, but a stuck overlay (browsers occasionally drop the
              dragleave/drop event) would otherwise trap the UI. */}
          <button
            type="button"
            aria-label={t("drop.cancel")}
            onClick={() => {
              dragDepth.current = 0;
              setIsDragging(false);
            }}
            className="pointer-events-auto absolute right-4 top-4 grid size-9 place-items-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-lg transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
          <div className="flex max-w-[min(440px,90vw)] flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/60 bg-card/90 px-10 py-8 text-center shadow-xl">
            {overlayIsCover ? (
              <ImagePlus aria-hidden="true" className="size-14 text-primary" />
            ) : (
              <UploadCloud aria-hidden="true" className="size-14 text-primary" />
            )}
            <h2 className="text-xl font-semibold">
              {overlayIsCover
                ? t("drop.imageDragTitle")
                : dragInfo.count > 1
                  ? t("drop.addTitleMultiple", { count: dragInfo.count })
                  : t("drop.addTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {overlayIsCover ? t("drop.imageDragSubtitle") : t("drop.addSubtitle")}
            </p>
          </div>
        </div>
      )}

      {pendingCover && (
        <ImageDropModal
          file={pendingCover.file}
          track={pendingCover.track}
          onClose={() => setPendingCover(null)}
          onDone={(kind) => setNotice({ kind, count: 1 })}
        />
      )}

      {pendingCrop && (
        <CoverCropDialog
          file={pendingCrop.file}
          saving={savingCrop}
          onConfirm={async (crop) => {
            if (savingCrop) return;
            setSavingCrop(true);
            await setTrackCover({
              trackId: pendingCrop.track.id,
              blob: pendingCrop.file,
              mime: pendingCrop.file.type || "image/jpeg",
              crop,
            });
            setNotice({ kind: "cover", count: 1 });
            setPendingCrop(null);
            setSavingCrop(false);
          }}
          onCancel={() => setPendingCrop(null)}
        />
      )}

      {pendingMedia && (
        <SetPickerDialog
          files={pendingMedia.files}
          defaultNewSetName={pendingMedia.defaultNewSetName}
          onClose={() => setPendingMedia(null)}
          onUploaded={(count, createdSet) => {
            setNotice({ kind: "uploaded", count });
            if (createdSet) onMediaUploaded?.(true);
          }}
        />
      )}

      {importProgress && (
        <div
          className="fixed bottom-24 left-1/2 z-[70] flex w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-lg duration-200 animate-in slide-in-from-bottom-2"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            {importProgress.phase === "done" ? null : (
              <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">
              {importProgress.phase === "done"
                ? t("drop.imported", { count: importProgress.completed })
                : t("drop.importing", {
                    done: importProgress.completed,
                    total: importProgress.total,
                  })}
            </span>
            <button
              type="button"
              onClick={() => usePlayerStore.setState({ importProgress: null })}
              aria-label={t("drop.close")}
            >
              <X className="size-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          </div>
          {importProgress.current ? (
            <div className="min-w-0 truncate text-xs text-muted-foreground">
              {importProgress.current.mode === "reference"
                ? t("drop.importingReference", { name: importProgress.current.name })
                : t("drop.importingBytes", {
                    name: importProgress.current.name,
                    percent: importProgressPercent(importProgress) ?? 0,
                  })}
            </div>
          ) : null}
        </div>
      )}

      {notice && !importProgress && (
        <div
          className="fixed bottom-24 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-lg duration-200 animate-in slide-in-from-bottom-2"
          aria-live="polite"
        >
          {isUploading && notice.kind === "uploaded" ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : null}
          <span>
            {notice.kind === "uploaded"
              ? t("drop.uploaded", { count: notice.count })
              : notice.kind === "cover"
                ? t("drop.coverApplied")
                : notice.kind === "background"
                  ? t("drop.bgApplied")
                  : notice.kind === "gallery"
                    ? t("drop.galleryApplied")
                    : t("drop.skipped", { count: notice.count })}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("drop.cancel")}>
            <X className="size-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Choose what a dropped image becomes: the current track's cover, one of its
 * slideshow backgrounds, or — when nothing is playing — a global gallery image.
 * The target track is captured at drop time (see PendingCover), so playback
 * advancing can't retarget it.
 */
function ImageDropModal({
  file,
  track,
  onClose,
  onDone,
}: {
  file: File;
  track: Track | null;
  onClose: () => void;
  onDone: (kind: ImageAction) => void;
}) {
  const { t } = useTranslation();
  const previewUrl = useObjectUrl(file);
  const [saving, setSaving] = useState(false);
  const [cropping, setCropping] = useState(false);
  const mime = file.type || "image/jpeg";

  // Background / gallery images are blurred, so they skip the cropper; the cover
  // goes through the square crop step (CoverCropDialog → saveCover).
  async function run(action: "background" | "gallery") {
    if (saving) return;
    setSaving(true);
    if (action === "background" && track) {
      await Promise.all([
        addTrackBackground({ trackId: track.id, blob: file, mime }),
        saveSettings({ backgroundMode: "slideshow" }),
      ]);
    } else await addGalleryImage({ blob: file, mime });
    onDone(action);
    onClose();
  }

  async function saveCover(crop: CropRect) {
    if (!track || saving) return;
    setSaving(true);
    await setTrackCover({ trackId: track.id, blob: file, mime, crop });
    onDone("cover");
    onClose();
  }

  // Escape closes the modal (the backdrop is a focusable button below).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (cropping && track) {
    return (
      <CoverCropDialog
        file={file}
        saving={saving}
        onConfirm={saveCover}
        onCancel={() => setCropping(false)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 duration-150 animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={track ? t("drop.imageModalTitle") : t("drop.galleryModalTitle")}
    >
      <button
        type="button"
        aria-label={t("drop.cancel")}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm"
      />
      <div className="relative flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <h2 className="text-base font-semibold">
          {track ? t("drop.imageModalTitle") : t("drop.galleryModalTitle")}
        </h2>

        {previewUrl && (
          <img
            src={previewUrl}
            alt=""
            className="aspect-video w-full rounded-lg border border-border object-cover"
          />
        )}

        <p className="text-sm text-muted-foreground">
          {track ? t("drop.imageModalBody", { title: track.title }) : t("drop.galleryModalBody")}
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("drop.cancel")}
          </Button>
          {track ? (
            <>
              <Button variant="outline" onClick={() => void run("background")} loading={saving}>
                <Images className="size-4" />
                {t("drop.asBackground")}
              </Button>
              <Button onClick={() => setCropping(true)} loading={saving}>
                <ImagePlus className="size-4" />
                {t("drop.asCover")}
              </Button>
            </>
          ) : (
            <Button onClick={() => void run("gallery")} loading={saving}>
              <Images className="size-4" />
              {t("drop.toGallery")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
