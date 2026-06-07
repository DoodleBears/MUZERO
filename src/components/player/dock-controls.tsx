import { Repeat, Repeat1 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { VolumeControl } from "@/components/player/volume-control";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { playerShortcutHint } from "@/lib/player-hints";
import { isMac } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { nextRepeatMode } from "@/player/transport";
import { usePlayerStore } from "@/stores/player-store";

/**
 * The dock's secondary controls: repeat (off→all→one, ⌘R) + volume (hover
 * slider). Each subscribes narrowly so cycling repeat never re-renders the
 * volume control, and neither reacts to playback-progress ticks. Mounted to the
 * right of the player info, before the nav FAB. Hidden on the narrowest widths
 * (mobile reaches these via the full Now Playing transport row).
 */
export function DockControls({ className }: { className?: string }) {
  const { t } = useTranslation();
  const repeat = usePlayerStore((s) => s.repeat);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const mac = isMac();

  return (
    <TooltipProvider>
      <div className={cn("flex items-center gap-0.5", className)}>
        <ControlTooltip label={t("player.repeatLabel")} keys={playerShortcutHint("repeat", mac)}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setRepeat(nextRepeatMode(repeat))}
            aria-label={t("player.repeat", { mode: repeat })}
            aria-pressed={repeat !== "off"}
            className={cn(
              "rounded-full",
              repeat !== "off" ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {repeat === "one" ? <Repeat1 /> : <Repeat />}
          </Button>
        </ControlTooltip>
        <VolumeControl />
      </div>
    </TooltipProvider>
  );
}
