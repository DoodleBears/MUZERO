import { CircleHelp, RotateCcw } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import {
  patchVisualizerStyleTuning,
  resetVisualizerStyleTuning,
  resolveVisualizerAnalyserOptions,
  resolveVisualizerRenderOptions,
  resolveVisualizerStyleTuning,
  VISUALIZER_BANDS_PER_OCTAVE_MAX,
  VISUALIZER_BANDS_PER_OCTAVE_MIN,
  VISUALIZER_FFT_SIZE_OPTIONS,
  visualizerAuraRayCount,
  visualizerBandsPerOctave,
  visualizerDetailFromBandsPerOctave,
  visualizerWaveformPointCount,
} from "@/lib/visualizer-effect-settings";
import { getVisualizerMeta, resolveVisualizerStyle } from "@/visualizer/registry";
import type { VisualizerStyleId } from "@/visualizer/types";

type VisualizerFftSize = (typeof VISUALIZER_FFT_SIZE_OPTIONS)[number];

export function VisualizerTuningControls({
  className,
  showHeading = true,
}: {
  className?: string;
  showHeading?: boolean;
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const style = resolveVisualizerStyle(settings.visualizerStyle);
  const fftSizeLabelId = useId();
  if (style === "off") return null;

  const meta = getVisualizerMeta(style);
  const analyser = resolveVisualizerAnalyserOptions(meta, settings, style);
  const tuning = resolveVisualizerRenderOptions(settings, style);
  const styleTuning = resolveVisualizerStyleTuning(settings, style);
  const saveTuning = (patch: Parameters<typeof patchVisualizerStyleTuning>[2]) =>
    saveSettings(patchVisualizerStyleTuning(settings, style, patch));

  return (
    <div className={className ?? "mt-1 grid gap-3 border-border border-t pt-3"}>
      {showHeading ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground">
            {t("visualizer.tuning")}
          </span>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground text-xs transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void saveSettings(resetVisualizerStyleTuning(settings, style))}
          >
            <RotateCcw className="size-3.5" />
            {t("visualizer.resetStyle")}
          </button>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span id={fftSizeLabelId} className="text-xs font-medium text-muted-foreground">
            {t("visualizer.fftSize")}
          </span>
          <HelpButton label={t("visualizer.help.fftSize")} />
        </div>
        <Select
          value={String(analyser.fftSize)}
          onValueChange={(value) =>
            void saveTuning({
              fftSize: Number(value) as VisualizerFftSize,
            })
          }
        >
          <SelectTrigger aria-labelledby={fftSizeLabelId}>
            <SelectValue>{(value) => String(value)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {VISUALIZER_FFT_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <VisualizerSlider
        label={t("visualizer.smoothing", { value: formatNumber(analyser.smoothing) })}
        helpLabel={t("visualizer.help.smoothing")}
        min={0}
        max={0.99}
        step={0.01}
        value={analyser.smoothing}
        onChange={(v) => void saveTuning({ smoothing: v })}
      />
      <VisualizerSlider
        label={t("visualizer.minDecibels", { value: formatNumber(analyser.minDecibels) })}
        helpLabel={t("visualizer.help.minDecibels")}
        min={-120}
        max={-20}
        step={1}
        value={analyser.minDecibels}
        onChange={(v) => void saveTuning({ minDecibels: v })}
      />
      <VisualizerSlider
        label={t("visualizer.maxDecibels", { value: formatNumber(analyser.maxDecibels) })}
        helpLabel={t("visualizer.help.maxDecibels")}
        min={-80}
        max={0}
        step={1}
        value={analyser.maxDecibels}
        onChange={(v) => void saveTuning({ maxDecibels: v })}
      />
      <VisualizerSlider
        label={t("visualizer.intensity", { value: formatNumber(tuning.intensity) })}
        helpLabel={t("visualizer.help.intensity")}
        min={0}
        max={2}
        step={0.05}
        value={tuning.intensity}
        onChange={(v) => void saveTuning({ intensity: v })}
      />
      {showsMotion(style) ? (
        <VisualizerSlider
          label={t("visualizer.motion", { value: formatNumber(tuning.motion) })}
          helpLabel={t("visualizer.help.motion")}
          min={0}
          max={2}
          step={0.05}
          value={tuning.motion}
          onChange={(v) => void saveTuning({ motion: v })}
        />
      ) : null}
      <DensitySlider
        style={style}
        detail={tuning.detail}
        onChange={(detail) => void saveTuning({ detail })}
      />
      {showsSpread(style) ? (
        <VisualizerSlider
          label={t("visualizer.spread", { value: formatNumber(tuning.spread) })}
          helpLabel={t("visualizer.help.spread")}
          min={0.35}
          max={2}
          step={0.05}
          value={tuning.spread}
          onChange={(v) => void saveTuning({ spread: v })}
        />
      ) : null}
      <VisualizerSlider
        label={t("visualizer.glow", { value: formatNumber(tuning.glow) })}
        helpLabel={t("visualizer.help.glow")}
        min={0}
        max={2}
        step={0.05}
        value={tuning.glow}
        onChange={(v) => void saveTuning({ glow: v })}
      />
      {showsMirror(style) ? (
        <VisualizerSlider
          label={t("visualizer.mirror", { value: formatNumber(tuning.mirror) })}
          helpLabel={t("visualizer.help.mirror")}
          min={0}
          max={2}
          step={0.05}
          value={tuning.mirror}
          onChange={(v) => void saveTuning({ mirror: v })}
        />
      ) : null}
      {/* Background-composite controls — opacity + dim fade the visualizer back so
          it doesn't fight the foreground. Two sets: the normal one, and a
          separate one used WHEN lyrics are shown over it (so you can subdue the
          viz only then, to keep the words readable). Shared by Settings + the
          long-press panel, so both stay in sync. */}
      {(settings.visualizerAsBackground ?? false) ? (
        <>
          <span className="text-xs font-medium text-muted-foreground">
            {t("visualizer.bgNoLyrics")}
          </span>
          <VisualizerSlider
            label={t("visualizer.backgroundOpacity", {
              pct: settings.visualizerBackgroundOpacity ?? 100,
            })}
            helpLabel={t("visualizer.help.backgroundOpacity")}
            min={0}
            max={100}
            step={1}
            value={styleTuning.backgroundOpacity ?? settings.visualizerBackgroundOpacity ?? 100}
            onChange={(v) => void saveTuning({ backgroundOpacity: v })}
          />
          <VisualizerSlider
            label={t("visualizer.backgroundDim", { pct: settings.visualizerBackgroundDim ?? 0 })}
            helpLabel={t("visualizer.help.backgroundDim")}
            min={0}
            max={100}
            step={1}
            value={styleTuning.backgroundDim ?? settings.visualizerBackgroundDim ?? 0}
            onChange={(v) => void saveTuning({ backgroundDim: v })}
          />
          <span className="mt-1 text-xs font-medium text-muted-foreground">
            {t("visualizer.bgWithLyrics")}
          </span>
          <VisualizerSlider
            label={t("visualizer.backgroundOpacity", {
              pct: settings.visualizerBgOpacityLyrics ?? 60,
            })}
            helpLabel={t("visualizer.help.backgroundOpacity")}
            min={0}
            max={100}
            step={1}
            value={styleTuning.bgOpacityLyrics ?? settings.visualizerBgOpacityLyrics ?? 60}
            onChange={(v) => void saveTuning({ bgOpacityLyrics: v })}
          />
          <VisualizerSlider
            label={t("visualizer.backgroundDim", { pct: settings.visualizerBgDimLyrics ?? 40 })}
            helpLabel={t("visualizer.help.backgroundDim")}
            min={0}
            max={100}
            step={1}
            value={styleTuning.bgDimLyrics ?? settings.visualizerBgDimLyrics ?? 40}
            onChange={(v) => void saveTuning({ bgDimLyrics: v })}
          />
        </>
      ) : null}
    </div>
  );
}

function DensitySlider({
  detail,
  onChange,
  style,
}: {
  detail: number;
  onChange: (detail: number) => void;
  style: VisualizerStyleId;
}) {
  const { t } = useTranslation();
  if (!showsDensity(style)) return null;

  if (usesOctaveBands(style)) {
    const count = visualizerBandsPerOctave(detail);
    return (
      <VisualizerSlider
        label={t("visualizer.densityBands", { count })}
        helpLabel={t("visualizer.help.density")}
        min={VISUALIZER_BANDS_PER_OCTAVE_MIN}
        max={VISUALIZER_BANDS_PER_OCTAVE_MAX}
        step={1}
        value={count}
        onChange={(v) => onChange(visualizerDetailFromBandsPerOctave(v))}
      />
    );
  }

  if (style === "aura") {
    return (
      <VisualizerSlider
        label={t("visualizer.densityRays", { count: visualizerAuraRayCount(detail) })}
        helpLabel={t("visualizer.help.density")}
        min={8}
        max={512}
        step={8}
        value={visualizerAuraRayCount(detail)}
        onChange={(v) => onChange(v / 64)}
      />
    );
  }

  return (
    <VisualizerSlider
      label={t("visualizer.densityPoints", { count: visualizerWaveformPointCount(detail) })}
      helpLabel={t("visualizer.help.density")}
      min={16}
      max={768}
      step={8}
      value={visualizerWaveformPointCount(detail)}
      onChange={(v) => onChange(v / 96)}
    />
  );
}

function VisualizerSlider({
  helpLabel,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  helpLabel: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <HelpButton label={helpLabel} />
      </div>
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

function HelpButton({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="inline-grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CircleHelp className="size-3.5" />
          </button>
        }
      />
      <TooltipContent className="max-w-64 whitespace-normal font-normal leading-snug">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function showsMotion(style: VisualizerStyleId) {
  return ["bars", "radial", "led-reflex", "waveform", "scene-liquid", "scene-aurora"].includes(
    style,
  );
}

function showsDensity(style: VisualizerStyleId) {
  return ["aura", "bars", "radial", "led-reflex", "waveform"].includes(style);
}

function usesOctaveBands(style: VisualizerStyleId) {
  return ["bars", "radial", "led-reflex"].includes(style);
}

function showsSpread(style: VisualizerStyleId) {
  return ["aura", "bars", "radial", "led-reflex", "scene-liquid", "scene-aurora"].includes(style);
}

function showsMirror(style: VisualizerStyleId) {
  return ["led-reflex", "waveform"].includes(style);
}

function formatNumber(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}
