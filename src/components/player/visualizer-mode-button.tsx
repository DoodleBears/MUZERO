import { Check, Eye, EyeOff, ScanEye, ScanText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ControlTooltip } from "@/components/player/control-tooltip";
import {
  MODE_ICON_BUTTON,
  MODE_ICON_BUTTON_ACTIVE,
  MODE_ICON_BUTTON_IDLE,
  MODE_MENU_OPTION,
  MODE_MENU_OPTION_DESCRIPTION,
  MODE_MENU_OPTION_ICON,
  MODE_MENU_OPTION_LABEL,
  MODE_MENU_OPTION_TEXT,
} from "@/components/player/mode-chip-styles";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { useLongPress } from "@/hooks/use-long-press";
import { cn } from "@/lib/utils";
import { useVisualizerPanelStore } from "@/stores/visualizer-panel-store";
import {
  resolveVisualizerPlacement,
  type VisualizerPlacement,
  visualizerPlacementPatch,
} from "@/visualizer/placement";
import { resolveVisualizerStyle } from "@/visualizer/registry";

const PLACEMENT_LABEL_KEYS: Record<
  VisualizerPlacement,
  | "visualizer.modeOff"
  | "visualizer.modeBackground"
  | "visualizer.modeIdleOnly"
  | "visualizer.modeLyricsOnly"
> = {
  off: "visualizer.modeOff",
  background: "visualizer.modeBackground",
  idle: "visualizer.modeIdleOnly",
  lyrics: "visualizer.modeLyricsOnly",
};

const PLACEMENT_DESCRIPTION_KEYS: Record<
  VisualizerPlacement,
  | "visualizer.modeOffDescription"
  | "visualizer.modeBackgroundDescription"
  | "visualizer.modeIdleOnlyDescription"
  | "visualizer.modeLyricsOnlyDescription"
> = {
  off: "visualizer.modeOffDescription",
  background: "visualizer.modeBackgroundDescription",
  idle: "visualizer.modeIdleOnlyDescription",
  lyrics: "visualizer.modeLyricsOnlyDescription",
};

const PLACEMENT_ICONS: Record<VisualizerPlacement, typeof Eye> = {
  off: EyeOff,
  background: Eye,
  idle: ScanEye,
  lyrics: ScanText,
};

const PLACEMENT_OPTIONS: VisualizerPlacement[] = ["off", "background", "idle", "lyrics"];

/**
 * One-click visualizer placement toggle, aligned with Settings (and the `V`
 * shortcut): off -> background -> idle-only visualizer -> lyrics-only idle -> off.
 */
export function VisualizerModeButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const settings = useSettings();
  const placement = resolveVisualizerPlacement(settings);
  const setPanelOpen = useVisualizerPanelStore((s) => s.setOpen);
  const active = placement !== "off";
  const Icon = PLACEMENT_ICONS[placement];
  const modeLabel = t(PLACEMENT_LABEL_KEYS[placement]);
  const label = t("visualizer.toggleMode", {
    mode: modeLabel,
  });

  function selectPlacement(next: VisualizerPlacement) {
    void saveSettings(visualizerPlacementPatch(settings, next));
  }

  function openTuningPanel() {
    setPanelOpen(true);
    if (active) return;
    const currentStyle = resolveVisualizerStyle(settings.visualizerStyle);
    void saveSettings({
      visualizerStyle: currentStyle === "off" ? "bars" : currentStyle,
      visualizerAsBackground: true,
      visualizerIdleOnly: false,
      visualizerLyricsOnlyIdle: false,
    });
  }

  // Long-press is the touch-friendly twin of the right-click below.
  const { handlers, consumeClick } = useLongPress(openTuningPanel);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <ControlTooltip label={label} hint={t("visualizer.openSettingsHint")}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                if (!consumeClick()) return;
                e.preventDefault();
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openTuningPanel();
              }}
              {...handlers}
              aria-label={label}
              aria-pressed={active}
              className={cn(
                MODE_ICON_BUTTON,
                active ? MODE_ICON_BUTTON_ACTIVE : MODE_ICON_BUTTON_IDLE,
                className,
              )}
            >
              <Icon className="size-4" />
            </Button>
          }
        />
      </ControlTooltip>
      <PopoverContent className="w-64 p-2" side="top" sideOffset={10}>
        <PopoverTitle className="px-2 pt-1 pb-1">{t("visualizer.title")}</PopoverTitle>
        <p className="px-2 pb-2 text-muted-foreground text-xs">
          {t("visualizer.openSettingsHint")}
        </p>
        {PLACEMENT_OPTIONS.map((option) => {
          const OptionIcon = PLACEMENT_ICONS[option];
          const optionLabel = t(PLACEMENT_LABEL_KEYS[option]);
          const optionDescription = t(PLACEMENT_DESCRIPTION_KEYS[option]);
          const selected = option === placement;
          return (
            <button
              type="button"
              aria-pressed={selected}
              className={MODE_MENU_OPTION}
              key={option}
              onClick={() => {
                selectPlacement(option);
                setOpen(false);
              }}
            >
              <OptionIcon className={MODE_MENU_OPTION_ICON} />
              <span className={MODE_MENU_OPTION_TEXT}>
                <span className={MODE_MENU_OPTION_LABEL}>{optionLabel}</span>
                <span className={MODE_MENU_OPTION_DESCRIPTION}>{optionDescription}</span>
              </span>
              {selected && <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
