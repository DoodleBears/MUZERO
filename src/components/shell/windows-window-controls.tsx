import { Copy, Minus, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { HeaderPinButton } from "@/components/shell/header-pin-button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDesktopWindowStore } from "@/stores/desktop-window-store";

export function WindowsWindowControls() {
  const { t } = useTranslation();
  const closeOrHideToTray = useDesktopWindowStore((s) => s.closeOrHideToTray);
  const fullscreen = useDesktopWindowStore((s) => s.fullscreen);
  const init = useDesktopWindowStore((s) => s.init);
  const maximized = useDesktopWindowStore((s) => s.maximized);
  const minimize = useDesktopWindowStore((s) => s.minimize);
  const supported = useDesktopWindowStore((s) => s.windowsControlsSupported);
  const toggleMaximize = useDesktopWindowStore((s) => s.toggleMaximize);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!supported) return;
    return () => {
      delete document.documentElement.dataset.windowMaximized;
    };
  }, [supported]);

  if (!supported) return null;

  const isMaximized = maximized || fullscreen;

  const toolbar = (
    <div
      aria-label={t("windowControls.label")}
      className="windows-window-controls group fixed top-1 right-1.5 z-[80] flex h-9 w-32 items-center justify-end bg-transparent [-webkit-app-region:no-drag]"
      data-no-drag
      role="toolbar"
    >
      <div
        className="windows-window-controls__cluster flex h-full translate-y-[-2px] items-center gap-0 bg-transparent opacity-0 transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 [-webkit-app-region:no-drag]"
        data-no-drag
      >
        <HeaderPinButton />
        <WindowButton label={t("windowControls.minimize")} onClick={() => void minimize()}>
          <Minus />
        </WindowButton>
        <WindowButton
          hint={
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span>{t("windowControls.fullscreenHint")}</span>
              <Kbd className="h-4 min-w-4 text-[10px]">F</Kbd>
            </span>
          }
          label={isMaximized ? t("windowControls.restore") : t("windowControls.maximize")}
          onClick={() => void toggleMaximize()}
        >
          {isMaximized ? <Copy /> : <Square />}
        </WindowButton>
        <WindowButton
          className="hover:border-red-500/70 hover:bg-red-500 hover:text-white focus-visible:border-red-500/70 focus-visible:bg-red-500 focus-visible:text-white"
          label={t("windowControls.close")}
          onClick={() => void closeOrHideToTray()}
        >
          <X />
        </WindowButton>
      </div>
    </div>
  );

  return createPortal(<TooltipProvider>{toolbar}</TooltipProvider>, document.body);
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
