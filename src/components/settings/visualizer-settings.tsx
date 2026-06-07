import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { resolveVisualizerStyle, VISUALIZER_META } from "@/visualizer/registry";
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
  const asBackground = settings.visualizerAsBackground ?? true;
  const dim = settings.visualizerBackgroundDim ?? 0;
  const opacity = settings.visualizerBackgroundOpacity ?? 100;

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
