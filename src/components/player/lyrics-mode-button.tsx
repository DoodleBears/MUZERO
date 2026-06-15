import { Check, MicVocal, Quote } from "lucide-react";
import { useEffect, useState } from "react";
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
import { useLyricsPanelStore } from "@/stores/lyrics-panel-store";

/**
 * Lyrics/memory toggle, sibling of the visualizer-mode button: a tap switches
 * the Now-Playing right rail between lyrics and memories. When the visualizer
 * hides foreground panels, the same lyrics-on state is rendered as centered
 * immersive lyrics instead of a separate stage-only mode.
 */
export function LyricsModeButton({
  className,
  hasMemory = true,
  memoryShortcutKeys = ["N"],
}: {
  className?: string;
  hasMemory?: boolean;
  memoryShortcutKeys?: string[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const settings = useSettings();
  const lyricsVisible = !settings.nowPlayingRightRailCollapsed;
  const showingMemory = !lyricsVisible && hasMemory;
  const shortcut = formatShortcut(memoryShortcutKeys);
  const noMemoryHint = t("lyrics.noMemoryCreateHint", { shortcut });
  const description = showingMemory
    ? t("lyrics.switchToLyrics")
    : hasMemory
      ? t("lyrics.switchToMemory")
      : noMemoryHint;
  const TriggerIcon = showingMemory ? Quote : MicVocal;
  const showLyrics = () =>
    void saveSettings({
      lyricsStageOpen: true,
      nowPlayingRightRailCollapsed: false,
    });
  const showMemory = () => {
    if (!hasMemory) return;
    void saveSettings({
      lyricsStageOpen: false,
      nowPlayingRightRailCollapsed: true,
    });
  };
  const openPanel = useLyricsPanelStore((s) => s.setOpen);

  useEffect(() => {
    if (hasMemory || !settings.nowPlayingRightRailCollapsed) return;
    void saveSettings({
      lyricsStageOpen: true,
      nowPlayingRightRailCollapsed: false,
    });
  }, [hasMemory, settings.nowPlayingRightRailCollapsed]);

  function openSettings() {
    openPanel(true);
  }

  // Long-press is the touch-friendly twin of the right-click below.
  const { handlers, consumeClick } = useLongPress(openSettings);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <ControlTooltip label={description} hint={t("lyrics.openSettingsHint")}>
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
                openSettings();
              }}
              {...handlers}
              aria-label={description}
              aria-pressed={showingMemory}
              className={cn(
                MODE_ICON_BUTTON,
                showingMemory ? MODE_ICON_BUTTON_ACTIVE : MODE_ICON_BUTTON_IDLE,
                className,
              )}
            >
              <TriggerIcon className="size-4" />
            </Button>
          }
        />
      </ControlTooltip>
      <PopoverContent className="w-60 p-2" side="top" sideOffset={10}>
        <PopoverTitle className="px-2 pt-1 pb-1">{t("lyrics.modeMenu")}</PopoverTitle>
        <p className="px-2 pb-2 text-muted-foreground text-xs">{t("lyrics.openSettingsHint")}</p>
        <ModeOption
          active={!showingMemory}
          description={t("lyrics.switchToLyrics")}
          icon={MicVocal}
          label={t("lyrics.modeLyrics")}
          onClick={() => {
            showLyrics();
            setOpen(false);
          }}
        />
        <ModeOption
          active={showingMemory}
          description={hasMemory ? t("lyrics.switchToMemory") : noMemoryHint}
          disabled={!hasMemory}
          icon={Quote}
          label={t("lyrics.modeMemory")}
          onClick={() => {
            showMemory();
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function ModeOption({
  active,
  description,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  disabled?: boolean;
  icon: typeof MicVocal;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={MODE_MENU_OPTION}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className={MODE_MENU_OPTION_ICON} />
      <span className={MODE_MENU_OPTION_TEXT}>
        <span className={MODE_MENU_OPTION_LABEL}>{label}</span>
        <span className={MODE_MENU_OPTION_DESCRIPTION}>{description}</span>
      </span>
      {active && <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
    </button>
  );
}

function formatShortcut(keys: string[]): string {
  return keys.length > 0 ? keys.join("+") : "N";
}
