import { Minus, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

  return (
    <div
      aria-label={t("windowControls.label")}
      className="windows-window-controls fixed top-0 right-0 z-[80] flex h-14 w-48 items-start justify-end bg-transparent px-3 pt-2 [-webkit-app-region:no-drag]"
      data-no-drag
      role="toolbar"
    >
      <div className="windows-window-controls__cluster pointer-events-none flex translate-y-[-4px] items-center gap-1 rounded-full border border-white/12 bg-background/60 p-1 opacity-0 shadow-lg shadow-black/20 backdrop-blur-xl transition duration-150 dark:border-white/10 dark:bg-black/44">
        <WindowButton label={t("windowControls.minimize")} onClick={() => void controls.minimize()}>
          <Minus />
        </WindowButton>
        <WindowButton
          label={maximized ? t("windowControls.restore") : t("windowControls.maximize")}
          onClick={() => void toggleMaximize()}
        >
          <Square />
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
  label,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "flex size-8 items-center justify-center rounded-full border border-transparent text-foreground/70 outline-none transition hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background [&_svg]:size-3.5",
        className,
      )}
      data-no-drag
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
