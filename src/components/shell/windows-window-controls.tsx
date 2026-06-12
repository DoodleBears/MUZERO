import { Copy, Minus, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type DesktopBridge, resolveDesktopBridge } from "@/lib/desktop/bridge";
import { cn } from "@/lib/utils";

export function WindowsWindowControls() {
  const { t } = useTranslation();
  const bridge = useMemo(() => resolveDesktopBridge(), []);
  const controls = bridge.windowControls;
  const supported = bridge.kind === "electron" && isWindowsRuntime(bridge) && Boolean(controls);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!supported || !controls) return;
    let mounted = true;
    void controls.getState().then((state) => {
      if (!mounted) return;
      setMaximized(state.maximized || state.fullscreen);
      document.documentElement.dataset.windowMaximized = String(
        state.maximized || state.fullscreen,
      );
    });
    const unsubscribe = controls.onStateChange?.((state) => {
      const isMaximized = state.maximized || state.fullscreen;
      setMaximized(isMaximized);
      document.documentElement.dataset.windowMaximized = String(isMaximized);
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [controls, supported]);

  useEffect(() => {
    if (!supported) return;
    return () => {
      delete document.documentElement.dataset.windowMaximized;
    };
  }, [supported]);

  if (!supported || !controls) return null;

  const toggleMaximize = async () => {
    const state = await controls.toggleMaximize();
    const isMaximized = state.maximized || state.fullscreen;
    setMaximized(isMaximized);
    document.documentElement.dataset.windowMaximized = String(isMaximized);
  };

  const toolbar = (
    <div
      aria-label={t("windowControls.label")}
      className="windows-window-controls group fixed top-1 right-1.5 z-[80] flex h-9 w-24 items-center justify-end bg-transparent [-webkit-app-region:no-drag]"
      data-no-drag
      role="toolbar"
    >
      <div
        className="windows-window-controls__cluster flex h-full translate-y-[-2px] items-center gap-0 bg-transparent opacity-0 transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 [-webkit-app-region:no-drag]"
        data-no-drag
      >
        <WindowButton label={t("windowControls.minimize")} onClick={() => void controls.minimize()}>
          <Minus />
        </WindowButton>
        <WindowButton
          hint={
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span>{t("windowControls.fullscreenHint")}</span>
              <Kbd className="h-4 min-w-4 text-[10px]">F</Kbd>
            </span>
          }
          label={maximized ? t("windowControls.restore") : t("windowControls.maximize")}
          onClick={() => void toggleMaximize()}
        >
          {maximized ? <Copy /> : <Square />}
        </WindowButton>
        <WindowButton
          className="hover:border-red-500/70 hover:bg-red-500 hover:text-white focus-visible:border-red-500/70 focus-visible:bg-red-500 focus-visible:text-white"
          label={t("windowControls.close")}
          onClick={() => void controls.close()}
        >
          <X />
        </WindowButton>
      </div>
    </div>
  );

  return createPortal(<TooltipProvider>{toolbar}</TooltipProvider>, document.body);
}

function isWindowsRuntime(bridge: DesktopBridge): boolean {
  if (bridge.platform) return bridge.platform === "win32";
  if (typeof navigator === "undefined") return false;
  return (
    navigator.platform.toLowerCase().startsWith("win") || navigator.userAgent.includes("Windows")
  );
}

function WindowButton({
  children,
  className,
  hint,
  label,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            className={cn(
              "flex size-7.5 items-center justify-center rounded-md border border-transparent text-foreground/70 outline-none transition hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background [&_svg]:size-3",
              className,
            )}
            data-no-drag
            onClick={onClick}
            type="button"
          >
            {children}
          </button>
        }
      />
      <TooltipContent side="bottom" sideOffset={6}>
        <span className="flex flex-col gap-1">
          <span>{label}</span>
          {hint}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
