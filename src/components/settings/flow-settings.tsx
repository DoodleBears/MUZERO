import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { FlowEffectId } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import {
  FLOW_DEFAULT_COLORS,
  FLOW_EFFECTS,
  FLOW_MAX_COLORS,
  FLOW_MIN_COLORS,
  FLOW_PRESETS,
  normalizeHexColor,
} from "@/lib/flow-config";
import { cn } from "@/lib/utils";
import { VisualizerHost } from "@/visualizer/host";

/**
 * "Flow background" settings: pick the flowing-light effect, choose whether it
 * follows the cover palette or a fixed custom set (always configured, since it's
 * the no-cover fallback), and tune motion / dim / opacity. Saves immediately
 * (appearance-style). All flow values resolve through `resolveFlowConfig`.
 */
export function FlowSettings() {
  const { t } = useTranslation();
  // Effect/preset labelKeys are typed `string` (not literal i18n keys), so pass a
  // defaultValue to satisfy i18next's strict key typing.
  const tk = (key: string) => t(key, { defaultValue: key });
  const settings = useSettings();
  const source = settings.flowColorSource ?? "cover";
  const effect = settings.flowEffect ?? "aurora-drift";
  const colors =
    settings.flowCustomColors && settings.flowCustomColors.length >= FLOW_MIN_COLORS
      ? settings.flowCustomColors
      : FLOW_DEFAULT_COLORS;
  const isFlowBackground =
    settings.visualizerStyle === "scene-flow" && (settings.visualizerAsBackground ?? false);

  const setColors = (next: string[]) => void saveSettings({ flowCustomColors: next });
  const updateColor = (index: number, hex: string) => {
    const next = colors.slice();
    next[index] = normalizeHexColor(hex) ?? hex;
    setColors(next);
  };
  const addColor = () => {
    if (colors.length < FLOW_MAX_COLORS) setColors([...colors, "#8b5cf6"]);
  };
  const removeColor = (index: number) => {
    if (colors.length > FLOW_MIN_COLORS) setColors(colors.filter((_, i) => i !== index));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("flow.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">{t("flow.intro")}</p>

        {/* Live preview — follows the current cover palette (or the custom fallback). */}
        <div className="relative h-32 overflow-hidden rounded-lg border border-border bg-background">
          <VisualizerHost
            active
            styleId="scene-flow"
            coverColor
            placement="background"
            className="absolute inset-0"
          />
        </div>

        {isFlowBackground ? (
          <p className="text-xs text-primary">{t("flow.activeAsBackground")}</p>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              void saveSettings({ visualizerStyle: "scene-flow", visualizerAsBackground: true })
            }
          >
            {t("flow.useAsBackground")}
          </Button>
        )}

        <Field label={t("flow.effect")}>
          <Select
            value={effect}
            onValueChange={(value) => void saveSettings({ flowEffect: value as FlowEffectId })}
          >
            <SelectTrigger>
              <SelectValue>
                {(value) =>
                  tk(FLOW_EFFECTS.find((e) => e.id === value)?.labelKey ?? "flow.effectAuroraDrift")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FLOW_EFFECTS.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {tk(e.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t("flow.colorSource")}>
          <div className="flex gap-2">
            <SourceButton
              active={source === "cover"}
              onClick={() => void saveSettings({ flowColorSource: "cover" })}
            >
              {t("flow.sourceCover")}
            </SourceButton>
            <SourceButton
              active={source === "custom"}
              onClick={() => void saveSettings({ flowColorSource: "custom" })}
            >
              {t("flow.sourceCustom")}
            </SourceButton>
          </div>
          <p className="text-xs text-muted-foreground">{t("flow.sourceHint")}</p>
        </Field>

        <Field label={t("flow.customColors")}>
          <p className="-mt-1 text-xs text-muted-foreground">{t("flow.customColorsHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {colors.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the slot index IS the color's identity (values can repeat)
              <div key={i} className="flex items-center gap-1">
                <ColorPicker
                  value={normalizeHexColor(c) ?? "#8b5cf6"}
                  onChange={(hex) => updateColor(i, hex)}
                  label={t("flow.colorN", { n: i + 1 })}
                />
                {colors.length > FLOW_MIN_COLORS ? (
                  <button
                    type="button"
                    onClick={() => removeColor(i)}
                    aria-label={t("flow.removeColor")}
                    className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
            {colors.length < FLOW_MAX_COLORS ? (
              <Button type="button" variant="outline" size="sm" onClick={addColor}>
                {t("flow.addColor")}
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("flow.presets")}</span>
            {FLOW_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setColors(p.colors)}
                title={tk(p.labelKey)}
                className="flex overflow-hidden rounded border border-border hover:ring-2 hover:ring-ring"
              >
                {p.colors.map((c) => (
                  <span key={c} className="size-4" style={{ backgroundColor: c }} />
                ))}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid gap-3 border-border border-t pt-3">
          <span className="text-xs font-medium text-muted-foreground">{t("flow.tuning")}</span>
          <PctSlider
            label={t("flow.motion", { pct: settings.flowMotion ?? 40 })}
            value={settings.flowMotion ?? 40}
            onChange={(v) => void saveSettings({ flowMotion: v })}
          />
          <PctSlider
            label={t("flow.scale", { pct: settings.flowScale ?? 50 })}
            value={settings.flowScale ?? 50}
            onChange={(v) => void saveSettings({ flowScale: v })}
          />
          <PctSlider
            label={t("flow.reactivity", { pct: settings.flowAudioReactivity ?? 20 })}
            value={settings.flowAudioReactivity ?? 20}
            onChange={(v) => void saveSettings({ flowAudioReactivity: v })}
          />
        </div>

        {isFlowBackground ? (
          <div className="grid gap-3 border-border border-t pt-3">
            <span className="text-xs font-medium text-muted-foreground">{t("flow.composite")}</span>
            <PctSlider
              label={t("visualizer.backgroundOpacity", {
                pct: settings.visualizerBackgroundOpacity ?? 100,
              })}
              value={settings.visualizerBackgroundOpacity ?? 100}
              onChange={(v) => void saveSettings({ visualizerBackgroundOpacity: v })}
            />
            <PctSlider
              label={t("visualizer.backgroundDim", { pct: settings.visualizerBackgroundDim ?? 0 })}
              value={settings.visualizerBackgroundDim ?? 0}
              onChange={(v) => void saveSettings({ visualizerBackgroundDim: v })}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function SourceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-primary bg-primary/15 font-medium text-primary"
          : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PctSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Slider min={0} max={100} step={1} value={value} onValueChange={onChange} />
    </div>
  );
}
