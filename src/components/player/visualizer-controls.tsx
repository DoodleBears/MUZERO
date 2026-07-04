import { useId } from "react";
import { useTranslation } from "react-i18next";
import { VisualizerBlendModeSelect } from "@/components/player/visualizer-blend-mode-select";
import {
  VisualizerHelpButton,
  VisualizerHelpLabel,
} from "@/components/player/visualizer-help-label";
import { VisualizerTuningControls } from "@/components/player/visualizer-tuning-controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import {
  resolveVisualizerStyle,
  VISUALIZER_META,
  VISUALIZER_PICKER_META,
} from "@/visualizer/registry";
import type { VisualizerStyleId } from "@/visualizer/types";

export function VisualizerControls({
  className,
  previewOnly,
}: {
  className?: string;
  previewOnly?: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  };
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const style = resolveVisualizerStyle(settings.visualizerStyle);
  const asBackground = settings.visualizerAsBackground ?? true;
  const idleOnly = settings.visualizerIdleOnly ?? false;
  const styleLabelId = useId();

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div data-visualizer-control="style" className="flex flex-col gap-1.5">
        <VisualizerHelpLabel id={styleLabelId} helpLabel={t("visualizer.help.style")}>
          {t("visualizer.style")}
        </VisualizerHelpLabel>
        <Select
          value={style}
          onValueChange={(value) =>
            void saveSettings({ visualizerStyle: value as VisualizerStyleId })
          }
        >
          <SelectTrigger aria-labelledby={styleLabelId}>
            <SelectValue>
              {(value) =>
                t(VISUALIZER_META.find((item) => item.id === value)?.labelKey ?? "visualizer.style")
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

      {previewOnly ? (
        <CheckboxControl
          controlId="preview-only"
          checked={previewOnly.checked}
          helpLabel={t("visualizer.help.previewOnly")}
          label={t("visualizer.previewOnly")}
          onCheckedChange={previewOnly.onCheckedChange}
        />
      ) : null}

      <CheckboxControl
        controlId="use-cover-color"
        checked={settings.visualizerUseCoverColor ?? true}
        helpLabel={t("visualizer.help.useCoverColor")}
        label={t("visualizer.useCoverColor")}
        onCheckedChange={(checked) => void saveSettings({ visualizerUseCoverColor: checked })}
      />

      <CheckboxControl
        controlId="video-track-visualizer"
        checked={settings.videoTrackVisualizerEnabled ?? true}
        helpLabel={t("visualizer.help.videoTracks")}
        label={t("visualizer.videoTracks")}
        onCheckedChange={(checked) => void saveSettings({ videoTrackVisualizerEnabled: checked })}
      />

      <CheckboxControl
        controlId="immersive-video-track-visualizer"
        checked={settings.immersiveVideoTrackVisualizerEnabled ?? false}
        helpLabel={t("visualizer.help.immersiveVideoTracks")}
        label={t("visualizer.immersiveVideoTracks")}
        onCheckedChange={(checked) =>
          void saveSettings({ immersiveVideoTrackVisualizerEnabled: checked })
        }
      />

      {asBackground ? (
        <div data-visualizer-control="blend-mode">
          <VisualizerBlendModeSelect />
        </div>
      ) : null}

      {asBackground ? (
        <CheckboxControl
          controlId="idle-only"
          checked={idleOnly}
          helpLabel={t("visualizer.help.idleOnly")}
          label={t("visualizer.idleOnly")}
          onCheckedChange={(checked) => void saveSettings({ visualizerIdleOnly: checked })}
        />
      ) : null}

      {asBackground && idleOnly ? (
        <CheckboxControl
          controlId="memory-overlay"
          checked={settings.immersiveMemoryOverlay ?? true}
          helpLabel={t("visualizer.help.memoryOverlay")}
          label={t("visualizer.memoryOverlay")}
          onCheckedChange={(checked) => void saveSettings({ immersiveMemoryOverlay: checked })}
        />
      ) : null}

      <CheckboxControl
        controlId="lyrics-memory-overlay"
        checked={settings.lyricsMemoryOverlay ?? true}
        helpLabel={t("visualizer.help.lyricsMemoryOverlay")}
        label={t("visualizer.lyricsMemoryOverlay")}
        onCheckedChange={(checked) => void saveSettings({ lyricsMemoryOverlay: checked })}
      />

      <div data-visualizer-control="tuning">
        <VisualizerTuningControls />
      </div>
    </div>
  );
}

function CheckboxControl({
  checked,
  controlId,
  helpLabel,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  controlId: string;
  helpLabel: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const inputId = useId();

  return (
    <div data-visualizer-control={controlId} className="flex items-start gap-2">
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
        className="mt-2 size-4 shrink-0 accent-[var(--color-primary)]"
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <label htmlFor={inputId} className="text-sm">
            {label}
          </label>
          <VisualizerHelpButton label={helpLabel} />
        </div>
      </div>
    </div>
  );
}
