import { useTranslation } from "react-i18next";
import { VisualizerBlendModeSelect } from "@/components/player/visualizer-blend-mode-select";
import { VisualizerTuningControls } from "@/components/player/visualizer-tuning-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import {
  resolveVisualizerStyle,
  VISUALIZER_META,
  VISUALIZER_PICKER_META,
} from "@/visualizer/registry";
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
  const asBackground = settings.visualizerAsBackground ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("visualizer.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("visualizer.style")}</span>
          <Select
            value={style}
            onValueChange={(value) =>
              void saveSettings({ visualizerStyle: value as VisualizerStyleId })
            }
          >
            <SelectTrigger>
              <SelectValue>
                {(value) =>
                  t(
                    VISUALIZER_META.find((item) => item.id === value)?.labelKey ??
                      "visualizer.style",
                  )
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {VISUALIZER_PICKER_META.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {t(m.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <VisualizerTuningControls />

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
            checked={settings.visualizerAsBackground ?? false}
            onChange={(e) => void saveSettings({ visualizerAsBackground: e.target.checked })}
            className="size-4 accent-[var(--color-primary)]"
          />
          {t("visualizer.asBackground")}
        </label>
        <p className="-mt-1 text-xs text-muted-foreground">{t("visualizer.asBackgroundHint")}</p>

        {asBackground ? (
          <>
            {/* Opacity + dim (incl. the separate "with lyrics" set) live in the
                shared VisualizerTuningControls above, so this page and the
                long-press tuning panel stay identical. */}
            <VisualizerBlendModeSelect />

            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.visualizerIdleOnly ?? false}
                onChange={(e) => void saveSettings({ visualizerIdleOnly: e.target.checked })}
                className="size-4 accent-[var(--color-primary)]"
              />
              {t("visualizer.idleOnly")}
            </label>
            <p className="-mt-1 text-xs text-muted-foreground">{t("visualizer.idleOnlyHint")}</p>

            {settings.visualizerIdleOnly ? (
              <>
                <label className="mt-1 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.immersiveMemoryOverlay ?? true}
                    onChange={(e) =>
                      void saveSettings({ immersiveMemoryOverlay: e.target.checked })
                    }
                    className="size-4 accent-[var(--color-primary)]"
                  />
                  {t("visualizer.memoryOverlay")}
                </label>
                <p className="-mt-1 text-xs text-muted-foreground">
                  {t("visualizer.memoryOverlayHint")}
                </p>
              </>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
