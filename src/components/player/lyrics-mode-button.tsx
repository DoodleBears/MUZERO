import { Captions } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { Button } from "@/components/ui/button";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { useLongPress } from "@/hooks/use-long-press";
import { cn } from "@/lib/utils";
import { useNavStore } from "@/stores/nav-store";

/**
 * Lyrics-focus toggle, sibling of the visualizer-mode button: a tap shows lyrics
 * on the Now-Playing stage (and, in immersive idle, centered over the
 * background); a long-press or right-click opens the lyrics settings — mirroring
 * the visualizer button's tap-cycle / hold-to-tune gestures.
 */
export function LyricsModeButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const open = useSettings().lyricsStageOpen ?? false;
  const toggle = () => void saveSettings({ lyricsStageOpen: !open });
  const setTab = useNavStore((s) => s.setTab);
  const setSettingsItem = useNavStore((s) => s.setSettingsItem);

  function openSettings() {
    setSettingsItem("lyrics");
    setTab("settings");
  }

  // Long-press is the touch-friendly twin of the right-click below.
  const { handlers, consumeClick } = useLongPress(openSettings);

  return (
    <ControlTooltip label={t("lyrics.toggleStage")} hint={t("lyrics.openSettingsHint")}>
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
        aria-label={t("lyrics.toggleStage")}
        aria-pressed={open}
        className={cn(
          "rounded-full border-0",
          open
            ? "bg-black/45 text-white shadow-sm hover:bg-black/50 data-pressed:bg-black/55"
            : "text-white/55 hover:bg-white/10 hover:text-white data-pressed:bg-white/10",
          className,
        )}
      >
        <Captions />
      </Button>
    </ControlTooltip>
  );
}
