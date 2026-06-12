import type React from "react";
import { useTranslation } from "react-i18next";
import { useVisualizerCoverColorCss } from "@/components/player/visualizer-dynamic-color";
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
import { useSettings } from "@/hooks/use-app-data";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import {
  ELECTRON_WINDOW_APPEARANCE_DEFAULTS,
  type ElectronWindowBorderColorMode,
  electronWindowAppearanceCssVars,
  resolveBorderColorMode,
} from "@/lib/electron-window-appearance";

const COLOR_MODES = [
  { id: "cover", labelKey: "settings.electronWindowBorderColorCover" },
  { id: "custom", labelKey: "settings.electronWindowBorderColorCustom" },
] as const;

export function ElectronWindowAppearanceSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const bridge = resolveDesktopBridge();
  const supported = bridge.kind === "electron";
  const borderColorMode = resolveBorderColorMode(settings.electronWindowBorderColorMode);
  const radius = settings.electronWindowRadius ?? ELECTRON_WINDOW_APPEARANCE_DEFAULTS.radius;
  const borderWidth =
    settings.electronWindowBorderWidth ?? ELECTRON_WINDOW_APPEARANCE_DEFAULTS.borderWidth;
  const borderOpacity =
    settings.electronWindowBorderOpacity ?? ELECTRON_WINDOW_APPEARANCE_DEFAULTS.borderOpacity;
  const borderColor =
    settings.electronWindowBorderColor ?? ELECTRON_WINDOW_APPEARANCE_DEFAULTS.borderColor;
  const coverColorCss = useVisualizerCoverColorCss(borderColorMode === "cover", {
    respectVisualizerSetting: false,
  });
  const previewVars = electronWindowAppearanceCssVars(settings, { coverColorCss });

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-3">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-sm">{t("settings.electronWindowTitle")}</span>
        <span className="text-muted-foreground text-xs">
          {supported ? t("settings.electronWindowHint") : t("settings.electronWindowUnavailable")}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="flex flex-col gap-4">
          <Field label={t("settings.electronWindowRadius", { px: radius })}>
            <Slider
              min={0}
              max={32}
              step={1}
              value={radius}
              onValueChange={(v) => void saveSettings({ electronWindowRadius: v })}
              aria-label={t("settings.electronWindowRadius", { px: radius })}
            />
          </Field>
          <Field label={t("settings.electronWindowBorderWidth", { px: borderWidth })}>
            <Slider
              min={0}
              max={8}
              step={1}
              value={borderWidth}
              onValueChange={(v) => void saveSettings({ electronWindowBorderWidth: v })}
              aria-label={t("settings.electronWindowBorderWidth", { px: borderWidth })}
            />
          </Field>
          {borderWidth > 0 && (
            <>
              <Field label={t("settings.electronWindowBorderColorSource")}>
                <Select
                  value={borderColorMode}
                  onValueChange={(v) =>
                    void saveSettings({
                      electronWindowBorderColorMode: v as ElectronWindowBorderColorMode,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(value) =>
                        t(
                          COLOR_MODES.find((mode) => mode.id === value)?.labelKey ??
                            "settings.electronWindowBorderColorSource",
                        )
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {COLOR_MODES.map((mode) => (
                      <SelectItem key={mode.id} value={mode.id}>
                        {t(mode.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {borderColorMode === "cover" && (
                  <p className="text-muted-foreground text-xs">
                    {t("settings.electronWindowBorderColorCoverHint")}
                  </p>
                )}
              </Field>
              {borderColorMode === "custom" && (
                <Field label={t("settings.electronWindowBorderColor")}>
                  <ColorPicker
                    label={t("settings.electronWindowBorderColor")}
                    value={borderColor}
                    onChange={(hex) => void saveSettings({ electronWindowBorderColor: hex })}
                  />
                </Field>
              )}
              <Field label={t("settings.electronWindowBorderOpacity", { pct: borderOpacity })}>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={borderOpacity}
                  onValueChange={(v) => void saveSettings({ electronWindowBorderOpacity: v })}
                  aria-label={t("settings.electronWindowBorderOpacity", { pct: borderOpacity })}
                />
              </Field>
            </>
          )}
        </div>

        <div className="grid min-h-32 place-items-center rounded-lg bg-muted/35 p-5">
          <div
            aria-label={t("settings.electronWindowPreview")}
            role="img"
            className="grid h-20 w-28 place-items-center bg-card text-card-foreground text-xs"
            style={{
              borderColor: previewVars["--electron-window-border-color"],
              borderRadius: previewVars["--electron-window-radius"],
              borderStyle: "solid",
              borderWidth: previewVars["--electron-window-border-width"],
            }}
          >
            MUZERO
          </div>
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
