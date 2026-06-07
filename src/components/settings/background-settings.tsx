import { useLiveQuery } from "dexie-react-hooks";
import { ImagePlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ColorPicker } from "@/components/ui/color-picker";
import { Slider } from "@/components/ui/slider";
import {
  addGalleryImage,
  deleteImageBlob,
  listGalleryImages,
  saveSettings,
} from "@/db/repositories";
import type { BackgroundMode, BackgroundRenderer } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { useObjectUrls } from "@/hooks/use-media";
import { BACKGROUND_EFFECT_DEFAULTS, dotScaleDefault } from "@/lib/background-effect-settings";
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
  const renderer = settings.backgroundRenderer ?? "noise";
  const gallery = useLiveQuery(() => listGalleryImages(), [], []);
  const blobs = useMemo(() => gallery.map((g) => g.blob), [gallery]);
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
            {t("background.renderer")}
          </span>
          <select
            value={renderer}
            onChange={(e) =>
              void saveSettings({ backgroundRenderer: e.target.value as BackgroundRenderer })
            }
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="image">{t("background.rendererImage")}</option>
            <option value="blur">{t("background.rendererBlur")}</option>
            <option value="pixel">{t("background.rendererPixel")}</option>
            <option value="ascii">{t("background.rendererAscii")}</option>
            <option value="cross-hatch">{t("background.rendererCrossHatch")}</option>
            <option value="crt">{t("background.rendererCrt")}</option>
            <option value="dot">{t("background.rendererDot")}</option>
            <option value="noise">{t("background.rendererNoise")}</option>
          </select>
        </label>

        {renderer === "blur" ? (
          <div className="mt-1 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("background.blur", { px: settings.backgroundBlur ?? 64 })}
            </span>
            <Slider
              min={0}
              max={80}
              step={1}
              value={settings.backgroundBlur ?? 64}
              onValueChange={(v) => void saveSettings({ backgroundBlur: v })}
              aria-label={t("background.blur", { px: settings.backgroundBlur ?? 64 })}
            />
          </div>
        ) : null}

        {["pixel", "ascii"].includes(renderer) ? (
          <div className="mt-1 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("background.pixelSize", { px: settings.backgroundPixelSize ?? 12 })}
            </span>
            <Slider
              min={4}
              max={32}
              step={1}
              value={settings.backgroundPixelSize ?? 12}
              onValueChange={(v) => void saveSettings({ backgroundPixelSize: v })}
              aria-label={t("background.pixelSize", { px: settings.backgroundPixelSize ?? 12 })}
            />
          </div>
        ) : null}

        {renderer === "ascii" ? (
          <div className="mt-1 grid gap-3 border-border border-t pt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                {t("background.asciiColor")}
              </span>
              <ColorPicker
                value={settings.backgroundAsciiColor ?? BACKGROUND_EFFECT_DEFAULTS.asciiColor}
                onChange={(hex) => void saveSettings({ backgroundAsciiColor: hex })}
                label={t("background.asciiColor")}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={
                  settings.backgroundAsciiReplaceColor ??
                  BACKGROUND_EFFECT_DEFAULTS.asciiReplaceColor
                }
                onChange={(e) =>
                  void saveSettings({ backgroundAsciiReplaceColor: e.target.checked })
                }
                className="size-4 accent-[var(--color-primary)]"
              />
              {t("background.asciiReplaceColor")}
            </label>
          </div>
        ) : null}

        {renderer === "crt" ? (
          <div className="mt-1 grid gap-3 border-border border-t pt-3">
            <EffectSlider
              label={t("background.crtCurvature", {
                value: formatNumber(
                  settings.backgroundCrtCurvature ?? BACKGROUND_EFFECT_DEFAULTS.crtCurvature,
                ),
              })}
              min={0}
              max={2}
              step={0.01}
              value={settings.backgroundCrtCurvature ?? BACKGROUND_EFFECT_DEFAULTS.crtCurvature}
              onChange={(v) => void saveSettings({ backgroundCrtCurvature: v })}
            />
            <EffectSlider
              label={t("background.crtLineWidth", {
                value: formatNumber(
                  settings.backgroundCrtLineWidth ?? BACKGROUND_EFFECT_DEFAULTS.crtLineWidth,
                ),
              })}
              min={0.25}
              max={4}
              step={0.05}
              value={settings.backgroundCrtLineWidth ?? BACKGROUND_EFFECT_DEFAULTS.crtLineWidth}
              onChange={(v) => void saveSettings({ backgroundCrtLineWidth: v })}
            />
            <EffectSlider
              label={t("background.crtLineContrast", {
                value: formatNumber(
                  settings.backgroundCrtLineContrast ?? BACKGROUND_EFFECT_DEFAULTS.crtLineContrast,
                ),
              })}
              min={0}
              max={1}
              step={0.01}
              value={
                settings.backgroundCrtLineContrast ?? BACKGROUND_EFFECT_DEFAULTS.crtLineContrast
              }
              onChange={(v) => void saveSettings({ backgroundCrtLineContrast: v })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={
                  settings.backgroundCrtVerticalLine ?? BACKGROUND_EFFECT_DEFAULTS.crtVerticalLine
                }
                onChange={(e) => void saveSettings({ backgroundCrtVerticalLine: e.target.checked })}
                className="size-4 accent-[var(--color-primary)]"
              />
              {t("background.crtVerticalLine")}
            </label>
            <EffectSlider
              label={t("background.crtTime", {
                value: formatNumber(
                  settings.backgroundCrtTime ?? BACKGROUND_EFFECT_DEFAULTS.crtTime,
                ),
              })}
              min={0}
              max={10}
              step={0.1}
              value={settings.backgroundCrtTime ?? BACKGROUND_EFFECT_DEFAULTS.crtTime}
              onChange={(v) => void saveSettings({ backgroundCrtTime: v })}
            />
            <EffectSlider
              label={t("background.crtNoise", {
                value: formatNumber(
                  settings.backgroundCrtNoise ?? BACKGROUND_EFFECT_DEFAULTS.crtNoise,
                ),
              })}
              min={0}
              max={1}
              step={0.01}
              value={settings.backgroundCrtNoise ?? BACKGROUND_EFFECT_DEFAULTS.crtNoise}
              onChange={(v) => void saveSettings({ backgroundCrtNoise: v })}
            />
            <EffectSlider
              label={t("background.crtNoiseSize", {
                value: formatNumber(
                  settings.backgroundCrtNoiseSize ?? BACKGROUND_EFFECT_DEFAULTS.crtNoiseSize,
                ),
              })}
              min={0}
              max={8}
              step={0.1}
              value={settings.backgroundCrtNoiseSize ?? BACKGROUND_EFFECT_DEFAULTS.crtNoiseSize}
              onChange={(v) => void saveSettings({ backgroundCrtNoiseSize: v })}
            />
            <EffectSlider
              label={t("background.crtSeed", {
                value: formatNumber(
                  settings.backgroundCrtSeed ?? BACKGROUND_EFFECT_DEFAULTS.crtSeed,
                ),
              })}
              min={0}
              max={1}
              step={0.01}
              value={settings.backgroundCrtSeed ?? BACKGROUND_EFFECT_DEFAULTS.crtSeed}
              onChange={(v) => void saveSettings({ backgroundCrtSeed: v })}
            />
            <EffectSlider
              label={t("background.crtVignetting", {
                value: formatNumber(
                  settings.backgroundCrtVignetting ?? BACKGROUND_EFFECT_DEFAULTS.crtVignetting,
                ),
              })}
              min={0}
              max={1}
              step={0.01}
              value={settings.backgroundCrtVignetting ?? BACKGROUND_EFFECT_DEFAULTS.crtVignetting}
              onChange={(v) => void saveSettings({ backgroundCrtVignetting: v })}
            />
            <EffectSlider
              label={t("background.crtVignettingAlpha", {
                value: formatNumber(
                  settings.backgroundCrtVignettingAlpha ??
                    BACKGROUND_EFFECT_DEFAULTS.crtVignettingAlpha,
                ),
              })}
              min={0}
              max={1}
              step={0.01}
              value={
                settings.backgroundCrtVignettingAlpha ??
                BACKGROUND_EFFECT_DEFAULTS.crtVignettingAlpha
              }
              onChange={(v) => void saveSettings({ backgroundCrtVignettingAlpha: v })}
            />
            <EffectSlider
              label={t("background.crtVignettingBlur", {
                value: formatNumber(
                  settings.backgroundCrtVignettingBlur ??
                    BACKGROUND_EFFECT_DEFAULTS.crtVignettingBlur,
                ),
              })}
              min={0}
              max={1}
              step={0.01}
              value={
                settings.backgroundCrtVignettingBlur ?? BACKGROUND_EFFECT_DEFAULTS.crtVignettingBlur
              }
              onChange={(v) => void saveSettings({ backgroundCrtVignettingBlur: v })}
            />
          </div>
        ) : null}

        {renderer === "dot" ? (
          <div className="mt-1 grid gap-3 border-border border-t pt-3">
            <EffectSlider
              label={t("background.dotScale", {
                value: formatNumber(
                  settings.backgroundDotScale ??
                    dotScaleDefault(settings.backgroundPixelSize ?? 12),
                ),
              })}
              min={0.2}
              max={6}
              step={0.05}
              value={
                settings.backgroundDotScale ?? dotScaleDefault(settings.backgroundPixelSize ?? 12)
              }
              onChange={(v) => void saveSettings({ backgroundDotScale: v })}
            />
            <EffectSlider
              label={t("background.dotAngle", {
                value: formatNumber(
                  settings.backgroundDotAngle ?? BACKGROUND_EFFECT_DEFAULTS.dotAngle,
                ),
              })}
              min={0}
              max={6.28}
              step={0.01}
              value={settings.backgroundDotAngle ?? BACKGROUND_EFFECT_DEFAULTS.dotAngle}
              onChange={(v) => void saveSettings({ backgroundDotAngle: v })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.backgroundDotGrayscale ?? BACKGROUND_EFFECT_DEFAULTS.dotGrayscale}
                onChange={(e) => void saveSettings({ backgroundDotGrayscale: e.target.checked })}
                className="size-4 accent-[var(--color-primary)]"
              />
              {t("background.dotGrayscale")}
            </label>
          </div>
        ) : null}

        {renderer === "noise" ? (
          <div className="mt-1 grid gap-3 border-border border-t pt-3">
            <EffectSlider
              label={t("background.noiseAmount", {
                value: formatNumber(
                  settings.backgroundNoiseAmount ?? BACKGROUND_EFFECT_DEFAULTS.noiseAmount,
                ),
              })}
              min={0}
              max={1}
              step={0.01}
              value={settings.backgroundNoiseAmount ?? BACKGROUND_EFFECT_DEFAULTS.noiseAmount}
              onChange={(v) => void saveSettings({ backgroundNoiseAmount: v })}
            />
            <EffectSlider
              label={t("background.noiseSeed", {
                value: formatNumber(
                  settings.backgroundNoiseSeed ?? BACKGROUND_EFFECT_DEFAULTS.noiseSeed,
                ),
              })}
              min={0}
              max={1}
              step={0.01}
              value={settings.backgroundNoiseSeed ?? BACKGROUND_EFFECT_DEFAULTS.noiseSeed}
              onChange={(v) => void saveSettings({ backgroundNoiseSeed: v })}
            />
          </div>
        ) : null}

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

function EffectSlider({
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={onChange}
        aria-label={label}
      />
    </div>
  );
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
