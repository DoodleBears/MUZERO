import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import {
  resolveVisualizerAnalyserOptions,
  resolveVisualizerRenderOptions,
  VISUALIZER_FFT_SIZE_OPTIONS,
} from "@/lib/visualizer-effect-settings";
import { getVisualizerMeta, resolveVisualizerStyle, VISUALIZER_META } from "@/visualizer/registry";
import type { VisualizerStyleId } from "@/visualizer/types";

/**
 * Now-Playing visualizer settings: pick the reactive style and (optionally) use
 * it as the full background. Saves immediately (appearance-style), like the
 * theme/primary controls. Style list comes from the registry — no hardcoding.
 */
export function VisualizerSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const style = resolveVisualizerStyle(settings.visualizerStyle);
  const meta = getVisualizerMeta(style);
  const analyser = resolveVisualizerAnalyserOptions(meta, settings);
  const tuning = resolveVisualizerRenderOptions(settings);
  const asBackground = settings.visualizerAsBackground ?? true;
  const dim = settings.visualizerBackgroundDim ?? 0;
  const opacity = settings.visualizerBackgroundOpacity ?? 100;
  const activeStyle = style !== "off";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("visualizer.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("visualizer.style")}</span>
          <select
            value={style}
            onChange={(e) =>
              void saveSettings({ visualizerStyle: e.target.value as VisualizerStyleId })
            }
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {VISUALIZER_META.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.labelKey)}
              </option>
            ))}
          </select>
        </label>

        {activeStyle ? (
          <div className="mt-1 grid gap-3 border-border border-t pt-3">
            <span className="text-xs font-medium text-muted-foreground">
              {t("visualizer.tuning")}
            </span>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("visualizer.fftSize")}
              </span>
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
            {showsDetail(style) ? (
              <VisualizerSlider
                label={t("visualizer.detail", { value: formatNumber(tuning.detail) })}
                min={0.35}
                max={2}
                step={0.05}
                value={tuning.detail}
                onChange={(v) => void saveSettings({ visualizerDetail: v })}
              />
            ) : null}
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
        ) : null}

        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.visualizerUseCoverColor ?? true}
            onChange={(e) => void saveSettings({ visualizerUseCoverColor: e.target.checked })}
            className="size-4 accent-[var(--color-primary)]"
          />
          {t("visualizer.useCoverColor")}
        </label>
        <p className="-mt-1 text-xs text-muted-foreground">{t("visualizer.useCoverColorHint")}</p>

        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.visualizerAsBackground ?? true}
            onChange={(e) => void saveSettings({ visualizerAsBackground: e.target.checked })}
            className="size-4 accent-[var(--color-primary)]"
          />
          {t("visualizer.asBackground")}
        </label>
        <p className="-mt-1 text-xs text-muted-foreground">{t("visualizer.asBackgroundHint")}</p>

        {asBackground ? (
          <>
            <div className="mt-1 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("visualizer.backgroundDim", { pct: dim })}
              </span>
              <Slider
                min={0}
                max={100}
                step={1}
                value={dim}
                onValueChange={(v) => void saveSettings({ visualizerBackgroundDim: v })}
                aria-label={t("visualizer.backgroundDim", { pct: dim })}
              />
            </div>

            <div className="mt-1 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("visualizer.backgroundOpacity", { pct: opacity })}
              </span>
              <Slider
                min={0}
                max={100}
                step={1}
                value={opacity}
                onValueChange={(v) => void saveSettings({ visualizerBackgroundOpacity: v })}
                aria-label={t("visualizer.backgroundOpacity", { pct: opacity })}
              />
            </div>

            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.visualizerInCoverArea ?? false}
                onChange={(e) => void saveSettings({ visualizerInCoverArea: e.target.checked })}
                className="size-4 accent-[var(--color-primary)]"
              />
              {t("visualizer.inCoverArea")}
            </label>
            <p className="-mt-1 text-xs text-muted-foreground">{t("visualizer.inCoverAreaHint")}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
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

function showsDetail(style: VisualizerStyleId) {
  return ["aura", "led-reflex", "waveform"].includes(style);
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
