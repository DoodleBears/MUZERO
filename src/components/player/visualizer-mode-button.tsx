import { AudioWaveform, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { Button } from "@/components/ui/button";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { useLongPress } from "@/hooks/use-long-press";
import { cn } from "@/lib/utils";
import { useVisualizerPanelStore } from "@/stores/visualizer-panel-store";
import { resolveVisualizerStyle } from "@/visualizer/registry";

type VisualizerPlacement = "off" | "background" | "idle";

const PLACEMENTS: VisualizerPlacement[] = ["off", "background", "idle"];
const PLACEMENT_LABEL_KEYS: Record<
  VisualizerPlacement,
  "visualizer.modeOff" | "visualizer.modeBackground" | "visualizer.modeIdleOnly"
> = {
  off: "visualizer.modeOff",
  background: "visualizer.modeBackground",
  idle: "visualizer.modeIdleOnly",
};

function resolvePlacement(settings: ReturnType<typeof useSettings>): VisualizerPlacement {
  const style = resolveVisualizerStyle(settings.visualizerStyle);
  if (style === "off" || !(settings.visualizerAsBackground ?? false)) return "off";
  return (settings.visualizerIdleOnly ?? false) ? "idle" : "background";
}

function nextPlacement(placement: VisualizerPlacement): VisualizerPlacement {
  return PLACEMENTS[(PLACEMENTS.indexOf(placement) + 1) % PLACEMENTS.length] ?? "off";
}

/**
 * One-click visualizer placement toggle, aligned with Settings:
 * off -> Now Playing background -> idle-only visualizer -> off.
 */
export function VisualizerModeButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const placement = resolvePlacement(settings);
  const setPanelOpen = useVisualizerPanelStore((s) => s.setOpen);
  const active = placement !== "off";
  const Icon = placement === "idle" ? EyeOff : AudioWaveform;
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
      visualizerIdleOnly: next === "idle",
    });
  }

  function openTuningPanel() {
    setPanelOpen(true);
    if (active) return;
    const currentStyle = resolveVisualizerStyle(settings.visualizerStyle);
    void saveSettings({
      visualizerStyle: currentStyle === "off" ? "bars" : currentStyle,
      visualizerAsBackground: true,
      visualizerIdleOnly: false,
    });
  }

  // Long-press is the touch-friendly twin of the right-click below.
  const { handlers, consumeClick } = useLongPress(openTuningPanel);

  return (
    <ControlTooltip label={label} hint={t("visualizer.openSettingsHint")}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          if (consumeClick()) return;
          cycle();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openTuningPanel();
        }}
        {...handlers}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "rounded-full border-0",
          active
            ? "bg-black/45 text-white shadow-sm hover:bg-black/50 data-pressed:bg-black/55"
            : "text-white/55 hover:bg-white/10 hover:text-white data-pressed:bg-white/10",
          className,
        )}
      >
        <Icon />
      </Button>
    </ControlTooltip>
  );
}
