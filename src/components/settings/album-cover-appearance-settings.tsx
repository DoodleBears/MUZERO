import type React from "react";
import { useTranslation } from "react-i18next";
import { Slider } from "@/components/ui/slider";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import {
  albumCoverAppearanceVars,
  resolveAlbumCoverAppearance,
} from "@/lib/album-cover-appearance";

export function AlbumCoverAppearanceSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const appearance = resolveAlbumCoverAppearance(settings);
  const { radius, shadowOpacity, shadowBlur, shadowOffsetX, shadowOffsetY } = appearance;

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
