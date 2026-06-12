import { ListMusic, Shuffle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { FavoriteControlButton } from "@/components/player/favorite-control-button";
import { VolumeControl } from "@/components/player/volume-control";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useShortcutHint } from "@/hooks/use-shortcut-hint";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

/**
 * The dock's secondary controls. Each leaf subscribes narrowly so
 * transport/progress ticks don't repaint the whole dock. Mounted in row 1 to
 * the left of play/pause.
 */
export function DockControls({
  className,
  onOpenQueue,
}: {
  className?: string;
  onOpenQueue?: () => void;
}) {
  const { t } = useTranslation();
  const shuffle = usePlayerStore((s) => s.shuffle);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const hint = useShortcutHint();

  return (
    <TooltipProvider>
      <div className={cn("flex items-center gap-0.5", className)}>
        {onOpenQueue && (
          <ControlTooltip label={t("nowPlaying.upNext")} keys={hint("queue")}>
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenQueue}
              aria-label={t("nowPlaying.upNext")}
              className="size-8 rounded-full text-muted-foreground transition-colors hover:text-foreground sm:size-9"
            >
              <ListMusic />
            </Button>
          </ControlTooltip>
        )}
        <ControlTooltip label={t("player.shuffle")} keys={hint("shuffle")}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShuffle(!shuffle)}
            aria-label={t("player.shuffle")}
            aria-pressed={shuffle}
            className={cn(
              "size-8 rounded-full sm:size-9",
              shuffle ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Shuffle />
          </Button>
        </ControlTooltip>
        <VolumeControl className="max-[420px]:hidden" />
        <FavoriteControlButton className="size-8 sm:size-9" />
      </div>
    </TooltipProvider>
  );
}
