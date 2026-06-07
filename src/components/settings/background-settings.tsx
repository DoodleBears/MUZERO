import { useLiveQuery } from "dexie-react-hooks";
import { ImagePlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  addGalleryImage,
  deleteImageBlob,
  listGalleryImages,
  saveSettings,
} from "@/db/repositories";
import type { BackgroundMode } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { useObjectUrls } from "@/hooks/use-media";
import { classifyDrop, filesFromTransfer, IMAGE_ACCEPT } from "@/lib/file-drop";

/** Slideshow auto-advance presets, in seconds (5s … 10min). */
const SLIDE_INTERVAL_PRESETS = [5, 10, 15, 30, 60, 120, 180, 300, 600];

/**
 * Now-Playing background settings: pick the source (cover vs slideshow) and
 * manage the global image gallery the slideshow falls back to. Per-song
 * backgrounds are bound by dropping an image while that track plays.
 */
export function BackgroundSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const mode = settings.backgroundMode ?? "cover";
  const gallery = useLiveQuery(() => listGalleryImages(), [], []);
  const blobs = useMemo(() => gallery.map((g) => g.blob), [gallery]);
  const urls = useObjectUrls(blobs);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const addImages = useCallback(async (files: File[]) => {
    for (const file of files) {
      if (file.type.startsWith("image/")) await addGalleryImage({ blob: file, mime: file.type });
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
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("background.mode")}</span>
          <select
            value={mode}
            onChange={(e) =>
              void saveSettings({ backgroundMode: e.target.value as BackgroundMode })
            }
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="cover">{t("background.modeCover")}</option>
            <option value="slideshow">{t("background.modeSlideshow")}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("background.slideshowInterval")}
          </span>
          <select
            value={settings.backgroundSlideshowIntervalSec ?? 300}
            onChange={(e) =>
              void saveSettings({ backgroundSlideshowIntervalSec: Number(e.target.value) })
            }
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {SLIDE_INTERVAL_PRESETS.map((sec) => (
              <option key={sec} value={sec}>
                {sec < 60
                  ? t("background.everySeconds", { count: sec })
                  : t("background.everyMinutes", { count: sec / 60 })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.backgroundSlideshowShuffle ?? true}
            onChange={(e) => void saveSettings({ backgroundSlideshowShuffle: e.target.checked })}
            className="size-4 accent-[var(--color-primary)]"
          />
          {t("background.slideshowShuffle")}
        </label>

        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.backgroundGalleryFallback ?? true}
            onChange={(e) => void saveSettings({ backgroundGalleryFallback: e.target.checked })}
            className="size-4 accent-[var(--color-primary)]"
          />
          {t("background.galleryFallback")}
        </label>
        <p className="-mt-1 text-xs text-muted-foreground">{t("background.galleryFallbackHint")}</p>

        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.coverCropped ?? true}
            onChange={(e) => void saveSettings({ coverCropped: e.target.checked })}
            className="size-4 accent-[var(--color-primary)]"
          />
          {t("background.coverCropped")}
        </label>
        <p className="-mt-1 text-xs text-muted-foreground">{t("background.coverCroppedHint")}</p>

        <div className="mt-1 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("background.blur", { px: settings.backgroundBlur ?? 12 })}
          </span>
          <Slider
            min={0}
            max={80}
            step={1}
            value={settings.backgroundBlur ?? 12}
            onValueChange={(v) => void saveSettings({ backgroundBlur: v })}
            aria-label={t("background.blur", { px: settings.backgroundBlur ?? 12 })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("background.mask", { pct: settings.backgroundMaskOpacity ?? 25 })}
          </span>
          <Slider
            min={0}
            max={100}
            step={1}
            value={settings.backgroundMaskOpacity ?? 25}
            onValueChange={(v) => void saveSettings({ backgroundMaskOpacity: v })}
            aria-label={t("background.mask", { pct: settings.backgroundMaskOpacity ?? 25 })}
          />
        </div>

        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.immersiveIdle ?? true}
            onChange={(e) => void saveSettings({ immersiveIdle: e.target.checked })}
            className="size-4 accent-[var(--color-primary)]"
          />
          {t("background.immersiveIdle")}
        </label>
        <p className="-mt-1 text-xs text-muted-foreground">{t("background.immersiveIdleHint")}</p>

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
