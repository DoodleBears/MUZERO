import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveSettings } from "@/db/repositories";
import type { AppSettings } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { GpuBackendControls } from "./gpu-backend-controls";

/**
 * The "Performance" pane: a switches-only home for the cost/acceleration trade-offs
 * — GPU backend + power (the dedicated home; the Background panel mirrors them) and
 * on/off toggles for the expensive Now Playing layers. Effect *tuning* (dim/opacity
 * sliders, renderer style) deliberately stays in the Background/Visualizer panes —
 * this page is only switches. See the performance-settings-hub PRD.
 */
export function PerformanceSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("performance.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {t("performance.groupGpu")}
        </span>
        <GpuBackendControls />
        <p className="-mt-1 text-xs text-muted-foreground">{t("performance.gpuHint")}</p>

        <div className="mt-1 grid gap-3 border-border border-t pt-3">
          <span className="text-xs font-medium text-muted-foreground">
            {t("performance.groupLayers")}
          </span>
          <PerfToggle
            field="visualizerAsBackground"
            fallback={true}
            settings={settings}
            label={t("performance.visualizerAsBackground")}
            hint={t("performance.visualizerAsBackgroundHint")}
          />
          <PerfToggle
            field="flowEnabled"
            fallback={true}
            settings={settings}
            label={t("performance.flow")}
            hint={t("performance.flowHint")}
          />
          <PerfToggle
            field="immersiveIdle"
            fallback={true}
            settings={settings}
            label={t("performance.immersiveIdle")}
            hint={t("performance.immersiveIdleHint")}
          />
        </div>

        <p className="text-xs text-muted-foreground">{t("performance.explainer")}</p>
      </CardContent>
    </Card>
  );
}

type BooleanSettingKey = {
  [K in keyof AppSettings]-?: NonNullable<AppSettings[K]> extends boolean ? K : never;
}[keyof AppSettings];

function PerfToggle({
  field,
  fallback,
  settings,
  label,
  hint,
}: {
  field: BooleanSettingKey;
  fallback: boolean;
  settings: AppSettings;
  label: ReactNode;
  hint: ReactNode;
}) {
  const checked = (settings[field] as boolean | undefined) ?? fallback;
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => void saveSettings({ [field]: e.target.checked })}
          className="size-4 accent-(--color-primary)"
        />
        {label}
      </label>
      <p className="-mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
