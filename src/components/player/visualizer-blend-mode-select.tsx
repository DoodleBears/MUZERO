import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSettings } from "@/db/repositories";
import type { FlowBlendMode } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { FLOW_BLEND_MODES, VISUALIZER_BLEND_DEFAULT } from "@/lib/flow-config";

/**
 * Blend-mode picker for the background visualizer (spectrum) layer — how it
 * composites with the flow + background below it (CSS mix-blend-mode). Shared by
 * the Settings page and the Now-Playing tuning panel so they stay in sync.
 */
export function VisualizerBlendModeSelect() {
  const { t } = useTranslation();
  const settings = useSettings();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t("flow.blend")}</span>
      <Select
        value={settings.visualizerBlendMode ?? VISUALIZER_BLEND_DEFAULT}
        onValueChange={(value) =>
          void saveSettings({ visualizerBlendMode: value as FlowBlendMode })
        }
      >
        <SelectTrigger>
          <SelectValue>
            {(value) =>
              t(FLOW_BLEND_MODES.find((b) => b.id === value)?.labelKey ?? "flow.blendNormal", {
                defaultValue: String(value),
              })
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {FLOW_BLEND_MODES.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {t(b.labelKey, { defaultValue: b.labelKey })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
