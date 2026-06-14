import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useShortcutHint } from "@/hooks/use-shortcut-hint";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

const TRANSPORT_BUTTON =
  "pointer-events-auto rounded-full border-2 border-primary/90 bg-background text-foreground shadow-lg transition-[background-color,color,border-color,box-shadow] duration-200 hover:border-primary hover:bg-primary hover:text-primary-foreground hover:shadow-primary/30 data-pressed:border-primary data-pressed:bg-primary data-pressed:text-primary-foreground [&_svg]:opacity-100";
const SIDE_BUTTON = `${TRANSPORT_BUTTON} size-12 sm:size-14 [&_svg]:size-6`;
const PLAY_BUTTON = `${TRANSPORT_BUTTON} size-16 shadow-xl sm:size-20 [&_svg]:size-8 sm:[&_svg]:size-10`;

/**
 * Full-size transport row for Now Playing. Secondary toggles live in the
 * Poweramp-style action row and the dock, so this stays focused on motion:
 * previous · play/pause · next.
 */
export const TransportControls = memo(function TransportControls({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const hint = useShortcutHint();

  return (
    <TooltipProvider>
      <div
        className={cn(
          "pointer-events-none flex items-center justify-center gap-4 sm:gap-5",
          className,
        )}
      >
        <ControlTooltip label={t("player.previous")} keys={hint("prev", { scope: "now" })}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void prev()}
            aria-label={t("player.previous")}
            className={SIDE_BUTTON}
          >
            <SkipBack />
          </Button>
        </ControlTooltip>
        <ControlTooltip
          label={isPlaying ? t("player.pause") : t("player.play")}
          keys={hint("play")}
        >
          <Button
            size="icon-xl"
            onClick={togglePlay}
            aria-label={isPlaying ? t("player.pause") : t("player.play")}
            className={PLAY_BUTTON}
          >
            {isPlaying ? <Pause /> : <Play />}
          </Button>
        </ControlTooltip>
        <ControlTooltip label={t("player.next")} keys={hint("next", { scope: "now" })}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void next()}
            aria-label={t("player.next")}
            className={SIDE_BUTTON}
          >
            <SkipForward />
          </Button>
        </ControlTooltip>
      </div>
    </TooltipProvider>
  );
});
