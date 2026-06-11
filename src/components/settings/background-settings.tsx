import { useLiveQuery } from "dexie-react-hooks";
import { ImagePlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { BackgroundEffectControls } from "@/components/settings/background-effect-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addGalleryImage, deleteImageBlob, listGalleryImages } from "@/db/repositories";
import { useObjectUrls } from "@/hooks/use-media";
import { classifyDrop, filesFromTransfer, IMAGE_ACCEPT } from "@/lib/file-drop";

/**
 * Now-Playing background settings: pick the source (cover vs slideshow) and
 * manage the global image gallery the slideshow falls back to. Per-song
 * backgrounds are bound by dropping an image while that track plays.
 */
export function BackgroundSettings() {
  const { t } = useTranslation();
  const gallery = useLiveQuery(() => listGalleryImages(), [], []);
  const blobs = useMemo(
    () => gallery.map((g) => g.blob).filter((blob): blob is Blob => Boolean(blob)),
    [gallery],
  );
  const urls = useObjectUrls(blobs);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const addImages = useCallback(async (files: File[]) => {
    const { images } = classifyDrop(files);
    for (const file of images) {
      await addGalleryImage({ blob: file, mime: file.type || "image/jpeg" });
    }
  }, []);

  // Paste multiple images straight into the slideshow gallery. This component only
  // mounts on the Settings tab, so a paste reaching here means the user is in
  // Settings — bulk-add every pasted image and stop the app-wide GlobalDropZone
  // from also catching it (it would open its single-image cover/background modal).
  // Capture phase runs before GlobalDropZone's bubble-phase window listener.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
        return; // let text paste into editable fields
      }
      const { images } = classifyDrop(filesFromTransfer(e.clipboardData));
      if (images.length === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void addImages(images);
    }
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [addImages]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("background.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <BackgroundEffectControls />

        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {t("background.gallery")}
          </span>
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <ImagePlus className="size-3.5" />
            {t("background.addImages")}
          </Button>
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
        </div>
        <p className="text-xs text-muted-foreground">{t("background.galleryDesc")}</p>

        {urls.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            {t("background.empty")}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {gallery.map((img, i) => (
              <div
                key={img.id}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border"
              >
                <img src={urls[i]} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => void deleteImageBlob(img.id)}
                  aria-label={t("background.removeImage")}
                  className="absolute right-1 top-1 rounded-full bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="size-3.5 text-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
