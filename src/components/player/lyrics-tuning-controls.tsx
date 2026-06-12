import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
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
import { cn } from "@/lib/utils";
import { LYRICS_MOTION_MODES, type LyricsMotionMode } from "@/lyrics/lyric-motion";

const COLOR_MODES = [
  { id: "default", labelKey: "lyricsSettings.colorDefault" },
  { id: "cover", labelKey: "lyricsSettings.colorCover" },
  { id: "custom", labelKey: "lyricsSettings.colorCustom" },
] as const;

const ALIGNS = [
  { id: "left", Icon: AlignLeft, labelKey: "lyricsSettings.alignLeft" },
  { id: "center", Icon: AlignCenter, labelKey: "lyricsSettings.alignCenter" },
  { id: "right", Icon: AlignRight, labelKey: "lyricsSettings.alignRight" },
] as const;

const MOTION_MODE_LABEL_KEYS = {
  classic: "lyricsSettings.motionClassic",
  inertial: "lyricsSettings.motionInertial",
  cascade: "lyricsSettings.motionCascade",
} as const satisfies Record<LyricsMotionMode, string>;

const MOTION_MODE_HINT_KEYS = {
  classic: "lyricsSettings.motionClassicHint",
  inertial: "lyricsSettings.motionInertialHint",
  cascade: "lyricsSettings.motionCascadeHint",
} as const satisfies Record<LyricsMotionMode, string>;

// The outline shares the text color's "cover"/"custom" sources (no "default":
// a stroke needs an explicit contrasting color, not the foreground).
const STROKE_COLOR_MODES = [
  { id: "custom", labelKey: "lyricsSettings.colorCustom" },
  { id: "cover", labelKey: "lyricsSettings.colorCover" },
] as const;

/**
 * Synced-lyrics appearance controls (font size + opacity for active vs inactive
 * lines, alignment, text-color source). Shared by the Settings page and the
 * Now-Playing floating tuning panel so both stay in sync. Writes straight to
 * AppSettings; SyncedLyricsView reads them.
 */
export function LyricsTuningControls({ className }: { className?: string }) {
  const { t } = useTranslation();
  const s = useSettings();
  const activeSize = s.lyricsActiveFontSize ?? 30;
  const inactiveSize = s.lyricsInactiveFontSize ?? 24;
  const activeOpacity = s.lyricsActiveOpacity ?? 100;
  const inactiveOpacity = s.lyricsInactiveOpacity ?? 40;
  const colorMode = s.lyricsColorMode ?? "default";
  const customColor = s.lyricsCustomColor ?? "#ffffff";
  const align = s.lyricsAlign ?? "center";
  const wordByWord = s.lyricsWordByWord ?? true;
  const showTranslation = s.lyricsShowTranslation ?? true;
  const showRomanization = s.lyricsShowRomanization ?? false;
  const motionMode = s.lyricsMotionMode ?? "classic";
  const lineGap = s.lyricsLineGap ?? 8;
  const shadowOpacity = s.lyricsShadowOpacity ?? 50;
  const shadowBlur = s.lyricsShadowBlur ?? 8;
  const shadowOffsetX = s.lyricsShadowOffsetX ?? 0;
  const shadowOffsetY = s.lyricsShadowOffsetY ?? 2;
  const strokeWidth = s.lyricsStrokeWidth ?? 0;
  const strokeColorMode = s.lyricsStrokeColorMode ?? "custom";
  const strokeColor = s.lyricsStrokeColor ?? "#000000";
  const strokeOpacity = s.lyricsStrokeOpacity ?? 100;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Toggle
        label={t("lyricsSettings.wordByWord")}
        hint={t("lyricsSettings.wordByWordHint")}
        value={wordByWord}
        onChange={(v) => void saveSettings({ lyricsWordByWord: v })}
      />
      <Toggle
        label={t("lyricsSettings.showTranslation")}
        hint={t("lyricsSettings.showTranslationHint")}
        value={showTranslation}
        onChange={(v) => void saveSettings({ lyricsShowTranslation: v })}
      />
      <Toggle
        label={t("lyricsSettings.showRomanization")}
        hint={t("lyricsSettings.showRomanizationHint")}
        value={showRomanization}
        onChange={(v) => void saveSettings({ lyricsShowRomanization: v })}
      />
      <Field label={t("lyricsSettings.motion")}>
        <div className="grid grid-cols-3 gap-1">
          {LYRICS_MOTION_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => void saveSettings({ lyricsMotionMode: mode })}
              aria-pressed={motionMode === mode}
              aria-label={t(MOTION_MODE_LABEL_KEYS[mode])}
              title={t(MOTION_MODE_HINT_KEYS[mode])}
              className={cn(
                "h-9 rounded-md border px-2 font-medium text-xs transition-colors",
                motionMode === mode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t(MOTION_MODE_LABEL_KEYS[mode])}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">{t(MOTION_MODE_HINT_KEYS[motionMode])}</p>
      </Field>
      <Field label={t("lyricsSettings.activeFontSize", { px: activeSize })}>
        <Slider
          min={12}
          max={48}
          step={1}
          value={activeSize}
          onValueChange={(v) => void saveSettings({ lyricsActiveFontSize: v })}
          aria-label={t("lyricsSettings.activeFontSize", { px: activeSize })}
        />
      </Field>
      <Field label={t("lyricsSettings.inactiveFontSize", { px: inactiveSize })}>
        <Slider
          min={12}
          max={48}
          step={1}
          value={inactiveSize}
          onValueChange={(v) => void saveSettings({ lyricsInactiveFontSize: v })}
          aria-label={t("lyricsSettings.inactiveFontSize", { px: inactiveSize })}
        />
      </Field>
      <Field label={t("lyricsSettings.lineGap", { px: lineGap })}>
        <Slider
          min={0}
          max={48}
          step={1}
          value={lineGap}
          onValueChange={(v) => void saveSettings({ lyricsLineGap: v })}
          aria-label={t("lyricsSettings.lineGap", { px: lineGap })}
        />
      </Field>
      <Field label={t("lyricsSettings.activeOpacity", { pct: activeOpacity })}>
        <Slider
          min={0}
          max={100}
          step={1}
          value={activeOpacity}
          onValueChange={(v) => void saveSettings({ lyricsActiveOpacity: v })}
          aria-label={t("lyricsSettings.activeOpacity", { pct: activeOpacity })}
        />
      </Field>
      <Field label={t("lyricsSettings.inactiveOpacity", { pct: inactiveOpacity })}>
        <Slider
          min={0}
          max={100}
          step={1}
          value={inactiveOpacity}
          onValueChange={(v) => void saveSettings({ lyricsInactiveOpacity: v })}
          aria-label={t("lyricsSettings.inactiveOpacity", { pct: inactiveOpacity })}
        />
      </Field>
      <Field label={t("lyricsSettings.align")}>
        <div className="flex gap-1">
          {ALIGNS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => void saveSettings({ lyricsAlign: m.id })}
              aria-pressed={align === m.id}
              aria-label={t(m.labelKey)}
              className={cn(
                "flex h-9 flex-1 items-center justify-center rounded-md border transition-colors",
                align === m.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <m.Icon className="size-4" />
            </button>
          ))}
        </div>
      </Field>
      <Field label={t("lyricsSettings.color")}>
        <Select
          value={colorMode}
          onValueChange={(v) =>
            void saveSettings({ lyricsColorMode: v as "default" | "cover" | "custom" })
          }
        >
          <SelectTrigger>
            <SelectValue>
              {(value) =>
                t(COLOR_MODES.find((m) => m.id === value)?.labelKey ?? "lyricsSettings.color")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {COLOR_MODES.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {t(m.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {colorMode === "custom" && (
          <input
            type="color"
            value={customColor}
            onChange={(e) => void saveSettings({ lyricsCustomColor: e.target.value })}
            className="mt-1 h-9 w-16 cursor-pointer rounded-md border border-border bg-transparent"
            aria-label={t("lyricsSettings.customColor")}
          />
        )}
        {colorMode === "cover" && (
          <p className="text-muted-foreground text-xs">{t("lyricsSettings.colorCoverHint")}</p>
        )}
      </Field>
      <Field label={t("lyricsSettings.shadowOpacity", { pct: shadowOpacity })}>
        <Slider
          min={0}
          max={100}
          step={1}
          value={shadowOpacity}
          onValueChange={(v) => void saveSettings({ lyricsShadowOpacity: v })}
          aria-label={t("lyricsSettings.shadowOpacity", { pct: shadowOpacity })}
        />
      </Field>
      <Field label={t("lyricsSettings.shadowBlur", { px: shadowBlur })}>
        <Slider
          min={0}
          max={48}
          step={1}
          value={shadowBlur}
          onValueChange={(v) => void saveSettings({ lyricsShadowBlur: v })}
          aria-label={t("lyricsSettings.shadowBlur", { px: shadowBlur })}
        />
      </Field>
      <Field label={t("lyricsSettings.shadowOffsetX", { px: shadowOffsetX })}>
        <Slider
          min={-32}
          max={32}
          step={1}
          value={shadowOffsetX}
          onValueChange={(v) => void saveSettings({ lyricsShadowOffsetX: v })}
          aria-label={t("lyricsSettings.shadowOffsetX", { px: shadowOffsetX })}
        />
      </Field>
      <Field label={t("lyricsSettings.shadowOffsetY", { px: shadowOffsetY })}>
        <Slider
          min={-32}
          max={32}
          step={1}
          value={shadowOffsetY}
          onValueChange={(v) => void saveSettings({ lyricsShadowOffsetY: v })}
          aria-label={t("lyricsSettings.shadowOffsetY", { px: shadowOffsetY })}
        />
      </Field>
      <Field label={t("lyricsSettings.strokeWidth", { px: strokeWidth })}>
        <Slider
          min={0}
          max={12}
          step={1}
          value={strokeWidth}
          onValueChange={(v) => void saveSettings({ lyricsStrokeWidth: v })}
          aria-label={t("lyricsSettings.strokeWidth", { px: strokeWidth })}
        />
      </Field>
      {strokeWidth > 0 && (
        <>
          <Field label={t("lyricsSettings.strokeColor")}>
            <Select
              value={strokeColorMode}
              onValueChange={(v) =>
                void saveSettings({ lyricsStrokeColorMode: v as "custom" | "cover" })
              }
            >
              <SelectTrigger>
                <SelectValue>
                  {(value) =>
                    t(
                      STROKE_COLOR_MODES.find((m) => m.id === value)?.labelKey ??
                        "lyricsSettings.strokeColor",
                    )
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STROKE_COLOR_MODES.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {t(m.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {strokeColorMode === "custom" && (
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => void saveSettings({ lyricsStrokeColor: e.target.value })}
                className="mt-1 h-9 w-16 cursor-pointer rounded-md border border-border bg-transparent"
                aria-label={t("lyricsSettings.strokeColor")}
              />
            )}
            {strokeColorMode === "cover" && (
              <p className="text-muted-foreground text-xs">{t("lyricsSettings.colorCoverHint")}</p>
            )}
          </Field>
          <Field label={t("lyricsSettings.strokeOpacity", { pct: strokeOpacity })}>
            <Slider
              min={0}
              max={100}
              step={1}
              value={strokeOpacity}
              onValueChange={(v) => void saveSettings({ lyricsStrokeOpacity: v })}
              aria-label={t("lyricsSettings.strokeOpacity", { pct: strokeOpacity })}
            />
          </Field>
        </>
      )}
    </div>
  );
}

/** An On/Off segmented toggle row (shared On/Off labels live under `wordByWord*`). */
function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label}>
      <div className="flex gap-1">
        {([true, false] as const).map((on) => (
          <button
            key={String(on)}
            type="button"
            onClick={() => onChange(on)}
            aria-pressed={value === on}
            className={cn(
              "h-9 flex-1 rounded-md border font-medium text-sm transition-colors",
              value === on
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t(on ? "lyricsSettings.wordByWordOn" : "lyricsSettings.wordByWordOff")}
          </button>
        ))}
      </div>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium text-muted-foreground text-xs">{label}</span>
      {children}
    </div>
  );
}
