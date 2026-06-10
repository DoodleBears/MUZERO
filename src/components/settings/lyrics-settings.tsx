import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

/**
 * Synced-lyrics appearance: font size + opacity for the active vs inactive lines,
 * and the text color source (theme default, cover-derived spectrum color, or a
 * custom hex). Writes straight to AppSettings; SyncedLyricsView reads them.
 */
export function LyricsSettings() {
  const { t } = useTranslation();
  const s = useSettings();
  const activeSize = s.lyricsActiveFontSize ?? 24;
  const inactiveSize = s.lyricsInactiveFontSize ?? 20;
  const activeOpacity = s.lyricsActiveOpacity ?? 100;
  const inactiveOpacity = s.lyricsInactiveOpacity ?? 40;
  const colorMode = s.lyricsColorMode ?? "default";
  const customColor = s.lyricsCustomColor ?? "#ffffff";
  const align = s.lyricsAlign ?? "left";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("lyricsSettings.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
      </CardContent>
    </Card>
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
