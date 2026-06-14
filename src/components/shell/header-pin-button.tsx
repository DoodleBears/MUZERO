import { Pin, PinOff } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { saveSettings } from "@/db/repositories";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { useDesktopWindowStore } from "@/stores/desktop-window-store";

type HeaderPinMode = "off" | "pin";

function resolvePinMode(mode: string | undefined): HeaderPinMode {
  return mode === "pin" || mode === "pin-click-through" ? "pin" : "off";
}

function persistedPinMode(mode: HeaderPinMode): "off" | "pin" {
  return mode === "off" ? "off" : "pin";
}

export function HeaderPinButton() {
  const { t } = useTranslation();
  const init = useDesktopWindowStore((s) => s.init);
  const pinMode = useDesktopWindowStore((s) => resolvePinMode(s.pinMode));
  const setClickThroughPaused = useDesktopWindowStore((s) => s.setClickThroughPaused);
  const setPinMode = useDesktopWindowStore((s) => s.setPinMode);
  const supported = useDesktopWindowStore((s) => s.pinSupported);

  useEffect(() => {
    init();
    return () => {
      setClickThroughPaused(false);
    };
  }, [init, setClickThroughPaused]);

  if (!supported) return null;

  const active = pinMode !== "off";
  const Icon = active ? Pin : PinOff;
  const label = active ? t("windowControls.pinOn") : t("windowControls.pinOff");

  async function togglePinMode() {
    try {
      const state = await setPinMode(pinMode === "off" ? "pin" : "off");
      if (!state) return;
      const next = resolvePinMode(state?.pinMode);
      await saveSettings({ desktopWindowPinMode: persistedPinMode(next) });
    } catch (error) {
      log.warn("desktop.windowPin", "Unable to update pin mode", error);
    }
  }

  // In pin-click-through the whole window passes clicks through (OS level), so the
  // button can't be clicked. Pausing passthrough while the cursor is over it makes
  // it interactive just long enough to click; leaving restores click-through. The
  // bridge no-ops unless the window is actually in pin-click-through.
  function pauseClickThrough(paused: boolean) {
    setClickThroughPaused(paused);
  }

  return (
    <TooltipProvider>
      <ControlTooltip label={label} side="bottom">
        <Button
          aria-label={label}
          aria-pressed={active}
          // Keep this in normal flow inside the window-control cluster so the
          // whole group is one contiguous no-drag island over Electron's drag
          // surface.
          className={cn(
            "size-7.5 shrink-0 rounded-md border border-transparent bg-transparent p-0 text-foreground/70 opacity-100 shadow-none transition [-webkit-app-region:no-drag] hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background sm:size-7.5 [&_svg]:size-3 sm:[&_svg]:size-3",
            active && "border-foreground/20 bg-foreground/10 text-foreground",
          )}
          data-no-drag
          onClick={() => void togglePinMode()}
          onMouseEnter={() => pauseClickThrough(true)}
          onMouseLeave={() => pauseClickThrough(false)}
          size="icon"
          variant="ghost"
        >
          <Icon />
        </Button>
      </ControlTooltip>
    </TooltipProvider>
  );
}
