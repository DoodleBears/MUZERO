import { useTranslation } from "react-i18next";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { saveSettings } from "@/db/repositories";
import type { BackgroundMode, BackgroundRenderer } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { BACKGROUND_EFFECT_DEFAULTS, dotScaleDefault } from "@/lib/background-effect-settings";
import { cn } from "@/lib/utils";

/** Slideshow auto-advance presets, in seconds (5s ... 10min). */
const SLIDE_INTERVAL_PRESETS = [5, 10, 15, 30, 60, 120, 180, 300, 600];

export function BackgroundEffectControls({ className }: { className?: string }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const mode = settings.backgroundMode ?? "cover";
  const renderer = settings.backgroundRenderer ?? "noise";
  const modeItems: { label: string; value: BackgroundMode }[] = [
    { value: "cover", label: t("background.modeCover") },
    { value: "slideshow", label: t("background.modeSlideshow") },
    { value: "none", label: t("background.modeNone") },
  ];
  const rendererItems: { label: string; value: BackgroundRenderer }[] = [
    { value: "image", label: t("background.rendererImage") },
    { value: "blur", label: t("background.rendererBlur") },
    { value: "pixel", label: t("background.rendererPixel") },
    { value: "ascii", label: t("background.rendererAscii") },
    { value: "cross-hatch", label: t("background.rendererCrossHatch") },
    { value: "crt", label: t("background.rendererCrt") },
    { value: "dot", label: t("background.rendererDot") },
    { value: "noise", label: t("background.rendererNoise") },
  ];
  const intervalItems = SLIDE_INTERVAL_PRESETS.map((sec) => ({
    value: String(sec),
    label:
      sec < 60
        ? t("background.everySeconds", { count: sec })
        : t("background.everyMinutes", { count: sec / 60 }),
  }));

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t("background.mode")}</span>
        <Select
          value={mode}
          onValueChange={(value) => void saveSettings({ backgroundMode: value as BackgroundMode })}
        >
          <SelectTrigger>
            <SelectValue>
              {(value) =>
                modeItems.find((item) => item.value === value)?.label ?? t("background.mode")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {modeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t("background.renderer")}
        </span>
        <Select
          value={renderer}
          onValueChange={(value) =>
            void saveSettings({ backgroundRenderer: value as BackgroundRenderer })
          }
        >
          <SelectTrigger>
            <SelectValue>
              {(value) =>
                rendererItems.find((item) => item.value === value)?.label ??
                t("background.renderer")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {rendererItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
                settings.backgroundAsciiReplaceColor ?? BACKGROUND_EFFECT_DEFAULTS.asciiReplaceColor
              }
              onChange={(e) => void saveSettings({ backgroundAsciiReplaceColor: e.target.checked })}
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
            value={settings.backgroundCrtLineContrast ?? BACKGROUND_EFFECT_DEFAULTS.crtLineContrast}
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
              value: formatNumber(settings.backgroundCrtTime ?? BACKGROUND_EFFECT_DEFAULTS.crtTime),
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
              value: formatNumber(settings.backgroundCrtSeed ?? BACKGROUND_EFFECT_DEFAULTS.crtSeed),
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
              settings.backgroundCrtVignettingAlpha ?? BACKGROUND_EFFECT_DEFAULTS.crtVignettingAlpha
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
                settings.backgroundDotScale ?? dotScaleDefault(settings.backgroundPixelSize ?? 12),
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

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t("background.slideshowInterval")}
        </span>
        <Select
          value={String(settings.backgroundSlideshowIntervalSec ?? 300)}
          onValueChange={(value) =>
            void saveSettings({ backgroundSlideshowIntervalSec: Number(value) })
          }
        >
          <SelectTrigger>
            <SelectValue>
              {(value) =>
                intervalItems.find((item) => item.value === value)?.label ??
                t("background.slideshowInterval")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {intervalItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
    </div>
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
