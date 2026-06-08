import { useTranslation } from "react-i18next";
import { Slider } from "@/components/ui/slider";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import {
  resolveVisualizerAnalyserOptions,
  resolveVisualizerRenderOptions,
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
  if (style === "off") return null;

  const meta = getVisualizerMeta(style);
  const analyser = resolveVisualizerAnalyserOptions(meta, settings);
  const tuning = resolveVisualizerRenderOptions(settings);

  return (
    <div className={className ?? "mt-1 grid gap-3 border-border border-t pt-3"}>
      {showHeading ? (
        <span className="text-xs font-medium text-muted-foreground">{t("visualizer.tuning")}</span>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t("visualizer.fftSize")}</span>
        <select
          value={analyser.fftSize}
          onChange={(e) =>
            void saveSettings({
              visualizerFftSize: Number(e.target.value) as 256 | 512 | 1024 | 2048,
            })
          }
          className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {VISUALIZER_FFT_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <VisualizerSlider
        label={t("visualizer.smoothing", { value: formatNumber(analyser.smoothing) })}
        min={0}
        max={0.99}
        step={0.01}
        value={analyser.smoothing}
        onChange={(v) => void saveSettings({ visualizerSmoothing: v })}
      />
      <VisualizerSlider
        label={t("visualizer.minDecibels", { value: formatNumber(analyser.minDecibels) })}
        min={-120}
        max={-20}
        step={1}
        value={analyser.minDecibels}
        onChange={(v) => void saveSettings({ visualizerMinDecibels: v })}
      />
      <VisualizerSlider
        label={t("visualizer.maxDecibels", { value: formatNumber(analyser.maxDecibels) })}
        min={-80}
        max={0}
        step={1}
        value={analyser.maxDecibels}
        onChange={(v) => void saveSettings({ visualizerMaxDecibels: v })}
      />
      <VisualizerSlider
        label={t("visualizer.intensity", { value: formatNumber(tuning.intensity) })}
        min={0}
        max={2}
        step={0.05}
        value={tuning.intensity}
        onChange={(v) => void saveSettings({ visualizerIntensity: v })}
      />
      {showsMotion(style) ? (
        <VisualizerSlider
          label={t("visualizer.motion", { value: formatNumber(tuning.motion) })}
          min={0}
          max={2}
          step={0.05}
          value={tuning.motion}
          onChange={(v) => void saveSettings({ visualizerMotion: v })}
        />
      ) : null}
      <DensitySlider style={style} detail={tuning.detail} />
      {showsSpread(style) ? (
        <VisualizerSlider
          label={t("visualizer.spread", { value: formatNumber(tuning.spread) })}
          min={0.35}
          max={2}
          step={0.05}
          value={tuning.spread}
          onChange={(v) => void saveSettings({ visualizerSpread: v })}
        />
      ) : null}
      <VisualizerSlider
        label={t("visualizer.glow", { value: formatNumber(tuning.glow) })}
        min={0}
        max={2}
        step={0.05}
        value={tuning.glow}
        onChange={(v) => void saveSettings({ visualizerGlow: v })}
      />
      {showsMirror(style) ? (
        <VisualizerSlider
          label={t("visualizer.mirror", { value: formatNumber(tuning.mirror) })}
          min={0}
          max={2}
          step={0.05}
          value={tuning.mirror}
          onChange={(v) => void saveSettings({ visualizerMirror: v })}
        />
      ) : null}
    </div>
  );
}

function DensitySlider({ detail, style }: { detail: number; style: VisualizerStyleId }) {
  const { t } = useTranslation();
  if (!showsDensity(style)) return null;

  if (usesOctaveBands(style)) {
    const count = visualizerBandsPerOctave(detail);
    return (
      <VisualizerSlider
        label={t("visualizer.densityBands", { count })}
        min={VISUALIZER_BANDS_PER_OCTAVE_MIN}
        max={VISUALIZER_BANDS_PER_OCTAVE_MAX}
        step={1}
        value={count}
        onChange={(v) =>
          void saveSettings({ visualizerDetail: visualizerDetailFromBandsPerOctave(v) })
        }
      />
    );
  }

  if (style === "aura") {
    return (
      <VisualizerSlider
        label={t("visualizer.densityRays", { count: visualizerAuraRayCount(detail) })}
        min={8}
        max={512}
        step={8}
        value={visualizerAuraRayCount(detail)}
        onChange={(v) => void saveSettings({ visualizerDetail: v / 64 })}
      />
    );
  }

  return (
    <VisualizerSlider
      label={t("visualizer.densityPoints", { count: visualizerWaveformPointCount(detail) })}
      min={16}
      max={768}
      step={8}
      value={visualizerWaveformPointCount(detail)}
      onChange={(v) => void saveSettings({ visualizerDetail: v / 96 })}
    />
  );
}

function VisualizerSlider({
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
