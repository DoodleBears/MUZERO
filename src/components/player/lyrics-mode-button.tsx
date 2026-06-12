import { Captions, CaptionsOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { Button } from "@/components/ui/button";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { useLongPress } from "@/hooks/use-long-press";
import { cn } from "@/lib/utils";
import { useLyricsPanelStore } from "@/stores/lyrics-panel-store";

/**
 * Lyrics/memory toggle, sibling of the visualizer-mode button: a tap switches
 * the Now-Playing right rail between lyrics and memories. When the visualizer
 * hides foreground panels, the same lyrics-on state is rendered as centered
 * immersive lyrics instead of a separate stage-only mode.
 */
export function LyricsModeButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const lyricsVisible = !useSettings().nowPlayingRightRailCollapsed;
  const label = lyricsVisible ? t("lyrics.hideToMemory") : t("lyrics.show");
  const Icon = lyricsVisible ? Captions : CaptionsOff;
  const toggle = () =>
    void saveSettings({
      lyricsStageOpen: !lyricsVisible,
      nowPlayingRightRailCollapsed: lyricsVisible,
    });
  const openPanel = useLyricsPanelStore((s) => s.setOpen);

  function openSettings() {
    openPanel(true);
  }

  // Long-press is the touch-friendly twin of the right-click below.
  const { handlers, consumeClick } = useLongPress(openSettings);

  return (
    <ControlTooltip label={label} hint={t("lyrics.openSettingsHint")}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          if (consumeClick()) return;
          toggle();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openSettings();
        }}
        {...handlers}
        aria-label={label}
        aria-pressed={lyricsVisible}
        className={cn(
          "rounded-full border-0",
          lyricsVisible
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
