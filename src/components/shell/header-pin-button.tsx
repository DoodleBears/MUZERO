import { MousePointerClick, Pin, PinOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { saveSettings } from "@/db/repositories";
import {
  type DesktopWindowPinMode,
  type DesktopWindowState,
  resolveDesktopBridge,
} from "@/lib/desktop/bridge";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";

function resolvePinMode(state: DesktopWindowState | undefined): DesktopWindowPinMode {
  return state?.pinMode === "pin" || state?.pinMode === "pin-click-through" ? state.pinMode : "off";
}

function persistedPinMode(mode: DesktopWindowPinMode): "off" | "pin" {
  return mode === "off" ? "off" : "pin";
}

export function HeaderPinButton() {
  const { t } = useTranslation();
  const bridge = useMemo(() => resolveDesktopBridge(), []);
  const controls = bridge.windowControls;
  const supported = Boolean(controls?.cyclePinMode && controls.getState);
  const [pinMode, setPinMode] = useState<DesktopWindowPinMode>("off");

  useEffect(() => {
    if (!supported || !controls) return;
    let mounted = true;
    void controls
      .getState()
      .then((state) => {
        if (mounted) setPinMode(resolvePinMode(state));
      })
      .catch((error) => log.warn("desktop.windowPin", "Unable to read pin mode", error));
    const unsubscribe = controls.onStateChange?.((state) => setPinMode(resolvePinMode(state)));
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [controls, supported]);

  if (!supported || !controls?.cyclePinMode) return null;

  const active = pinMode !== "off";
  const clickThrough = pinMode === "pin-click-through";
  const Icon = clickThrough ? MousePointerClick : active ? Pin : PinOff;
  const label = clickThrough
    ? t("windowControls.pinClickThrough")
    : active
      ? t("windowControls.pinOn")
      : t("windowControls.pinOff");
  const hint = clickThrough ? t("windowControls.pinClickThroughHint") : undefined;

  async function cyclePinMode() {
    if (!controls?.cyclePinMode) return;
    try {
      const state = await controls.cyclePinMode();
      const next = resolvePinMode(state);
      setPinMode(next);
      await saveSettings({ desktopWindowPinMode: persistedPinMode(next) });
    } catch (error) {
      log.warn("desktop.windowPin", "Unable to cycle pin mode", error);
    }
  }

  return (
    <TooltipProvider>
      <ControlTooltip label={label} hint={hint} side="bottom">
        <Button
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "absolute left-full ml-2 size-7 rounded-full border border-white/10 bg-black/30 text-white/70 opacity-0 shadow-sm backdrop-blur-md transition duration-150 [-webkit-app-region:no-drag] group-focus-within/header-logo:pointer-events-auto group-focus-within/header-logo:translate-x-0 group-focus-within/header-logo:opacity-100 group-hover/header-logo:pointer-events-auto group-hover/header-logo:translate-x-0 group-hover/header-logo:opacity-100",
            active && "pointer-events-auto translate-x-0 opacity-100",
            !active && "pointer-events-none translate-x-1",
            clickThrough && "border-primary/70 text-primary ring-1 ring-primary/50",
          )}
          data-no-drag
          onClick={() => void cyclePinMode()}
          size="icon"
          variant="ghost"
        >
          <Icon />
        </Button>
      </ControlTooltip>
    </TooltipProvider>
  );
}
