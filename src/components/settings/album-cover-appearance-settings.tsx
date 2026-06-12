import type React from "react";
import { useTranslation } from "react-i18next";
import { Slider } from "@/components/ui/slider";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import {
  albumCoverAppearanceVars,
  NOW_PLAYING_COVER_EFFECT_MODES,
  resolveAlbumCoverAppearance,
  resolveNowPlayingCoverBacklightAppearance,
  resolveNowPlayingCoverEffectMode,
} from "@/lib/album-cover-appearance";
import { cn } from "@/lib/utils";

export function AlbumCoverAppearanceSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const appearance = resolveAlbumCoverAppearance(settings);
  const { radius, shadowOpacity, shadowBlur, shadowOffsetX, shadowOffsetY } = appearance;
  const backlight = resolveNowPlayingCoverBacklightAppearance(settings);
  const nowPlayingEffectMode = resolveNowPlayingCoverEffectMode(settings.nowPlayingCoverEffectMode);
  const effectLabels = {
    shadow: t("settings.albumCoverEffectShadow"),
    backlight: t("settings.albumCoverEffectBacklight"),
    off: t("settings.albumCoverEffectOff"),
  };

  return (
    <div className="grid gap-4 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-sm">{t("settings.albumCoverTitle")}</span>
          <span className="text-muted-foreground text-xs">{t("settings.albumCoverHint")}</span>
        </div>
        <Field label={t("settings.albumCoverRadius", { px: radius })}>
          <Slider
            min={0}
            max={32}
            step={1}
            value={radius}
            onValueChange={(v) => void saveSettings({ albumCoverRadius: v })}
            aria-label={t("settings.albumCoverRadius", { px: radius })}
          />
        </Field>
        <Field label={t("settings.albumCoverShadowOpacity", { pct: shadowOpacity })}>
          <Slider
            min={0}
            max={100}
            step={1}
            value={shadowOpacity}
            onValueChange={(v) => void saveSettings({ albumCoverShadowOpacity: v })}
            aria-label={t("settings.albumCoverShadowOpacity", { pct: shadowOpacity })}
          />
        </Field>
        <Field label={t("settings.albumCoverShadowBlur", { px: shadowBlur })}>
          <Slider
            min={0}
            max={48}
            step={1}
            value={shadowBlur}
            onValueChange={(v) => void saveSettings({ albumCoverShadowBlur: v })}
            aria-label={t("settings.albumCoverShadowBlur", { px: shadowBlur })}
          />
        </Field>
        <Field label={t("settings.albumCoverShadowOffsetX", { px: shadowOffsetX })}>
          <Slider
            min={-32}
            max={32}
            step={1}
            value={shadowOffsetX}
            onValueChange={(v) => void saveSettings({ albumCoverShadowOffsetX: v })}
            aria-label={t("settings.albumCoverShadowOffsetX", { px: shadowOffsetX })}
          />
        </Field>
        <Field label={t("settings.albumCoverShadowOffsetY", { px: shadowOffsetY })}>
          <Slider
            min={-32}
            max={32}
            step={1}
            value={shadowOffsetY}
            onValueChange={(v) => void saveSettings({ albumCoverShadowOffsetY: v })}
            aria-label={t("settings.albumCoverShadowOffsetY", { px: shadowOffsetY })}
          />
        </Field>
        <Field label={t("settings.albumCoverNowPlayingEffect")}>
          <div className="grid grid-cols-3 gap-1">
            {NOW_PLAYING_COVER_EFFECT_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => void saveSettings({ nowPlayingCoverEffectMode: mode })}
                aria-pressed={nowPlayingEffectMode === mode}
                className={cn(
                  "h-9 rounded-md border px-2 font-medium text-xs transition-colors",
                  nowPlayingEffectMode === mode
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {effectLabels[mode]}
              </button>
            ))}
          </div>
        </Field>
        {nowPlayingEffectMode === "backlight" && (
          <>
            <Field label={t("settings.albumCoverBacklightOpacity", { pct: backlight.opacity })}>
              <Slider
                min={0}
                max={100}
                step={1}
                value={backlight.opacity}
                onValueChange={(v) => void saveSettings({ nowPlayingCoverBacklightOpacity: v })}
                aria-label={t("settings.albumCoverBacklightOpacity", {
                  pct: backlight.opacity,
                })}
              />
            </Field>
            <Field label={t("settings.albumCoverBacklightRange", { pct: backlight.range })}>
              <Slider
                min={0}
                max={40}
                step={1}
                value={backlight.range}
                onValueChange={(v) => void saveSettings({ nowPlayingCoverBacklightRange: v })}
                aria-label={t("settings.albumCoverBacklightRange", { pct: backlight.range })}
              />
            </Field>
            <Field label={t("settings.albumCoverBacklightBlur", { px: backlight.blur })}>
              <Slider
                min={0}
                max={64}
                step={1}
                value={backlight.blur}
                onValueChange={(v) => void saveSettings({ nowPlayingCoverBacklightBlur: v })}
                aria-label={t("settings.albumCoverBacklightBlur", { px: backlight.blur })}
              />
            </Field>
            <Field
              label={t("settings.albumCoverBacklightSaturation", {
                pct: backlight.saturation,
              })}
            >
              <Slider
                min={100}
                max={600}
                step={10}
                value={backlight.saturation}
                onValueChange={(v) => void saveSettings({ nowPlayingCoverBacklightSaturation: v })}
                aria-label={t("settings.albumCoverBacklightSaturation", {
                  pct: backlight.saturation,
                })}
              />
            </Field>
          </>
        )}
      </div>

      <div className="grid min-h-32 place-items-center rounded-lg bg-muted/35 p-5">
        <div
          aria-label={t("settings.albumCoverPreview")}
          role="img"
          className="grid aspect-square w-20 place-items-center overflow-hidden border border-border bg-secondary text-muted-foreground text-xs album-cover-radius album-cover-shadow"
          style={albumCoverAppearanceVars(appearance) as React.CSSProperties}
        >
          MUZERO
        </div>
      </div>
    </div>
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
