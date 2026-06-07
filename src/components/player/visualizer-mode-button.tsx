import { AudioWaveform, Layers2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { Button } from "@/components/ui/button";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { resolveVisualizerStyle } from "@/visualizer/registry";

type VisualizerPlacement = "off" | "background" | "both";

const PLACEMENTS: VisualizerPlacement[] = ["off", "background", "both"];
const PLACEMENT_LABEL_KEYS: Record<
  VisualizerPlacement,
  "visualizer.modeOff" | "visualizer.modeBackground" | "visualizer.modeBoth"
> = {
  off: "visualizer.modeOff",
  background: "visualizer.modeBackground",
  both: "visualizer.modeBoth",
};

function resolvePlacement(settings: ReturnType<typeof useSettings>): VisualizerPlacement {
  const style = resolveVisualizerStyle(settings.visualizerStyle);
  if (style === "off" || !(settings.visualizerAsBackground ?? true)) return "off";
  return (settings.visualizerInCoverArea ?? false) ? "both" : "background";
}

function nextPlacement(placement: VisualizerPlacement): VisualizerPlacement {
  return PLACEMENTS[(PLACEMENTS.indexOf(placement) + 1) % PLACEMENTS.length] ?? "off";
}

/**
 * One-click visualizer placement toggle, aligned with Settings:
 * off -> Now Playing background -> background + cover area -> off.
 */
export function VisualizerModeButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const placement = resolvePlacement(settings);
  const active = placement !== "off";
  const Icon = placement === "both" ? Layers2 : AudioWaveform;
  const label = t("visualizer.toggleMode", {
    mode: t(PLACEMENT_LABEL_KEYS[placement]),
  });

  function cycle() {
    const next = nextPlacement(placement);
    const currentStyle = resolveVisualizerStyle(settings.visualizerStyle);
    const enabledStyle = currentStyle === "off" ? "bars" : currentStyle;

    void saveSettings({
      visualizerStyle: next === "off" ? "off" : enabledStyle,
      visualizerAsBackground: next !== "off",
      visualizerInCoverArea: next === "both",
    });
  }

  return (
    <ControlTooltip label={label}>
      <Button
        variant="ghost"
        size="icon"
        onClick={cycle}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "rounded-full",
          active ? "text-primary" : "text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        <Icon />
      </Button>
    </ControlTooltip>
  );
}
