import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { HeaderPinButton } from "@/components/shell/header-pin-button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDesktopWindowStore } from "@/stores/desktop-window-store";

/**
 * macOS window controls: a single always-on-top (pin) button anchored top-right.
 *
 * Unlike Windows — where the app draws the whole minimize/maximize/close cluster
 * because the native frame is removed — macOS keeps its native traffic lights at
 * the top-LEFT (`titleBarStyle: "hiddenInset"`), so we deliberately render NEITHER
 * min/max/close NOR a left-side cluster. Only the pin button is missing natively,
 * and the top-right corner is free, so that's all this surfaces. Mirrors the
 * Windows cluster's body-portal + hover-reveal so pin UX matches across platforms.
 */
export function MacWindowControls() {
  const { t } = useTranslation();
  const init = useDesktopWindowStore((s) => s.init);
  const supported = useDesktopWindowStore((s) => s.macControlsSupported);

  useEffect(() => {
    init();
  }, [init]);

  if (!supported) return null;

  return createPortal(
    <TooltipProvider>
      <div
        aria-label={t("windowControls.label")}
        className="mac-window-controls group fixed top-1 right-1.5 z-[80] flex h-9 w-16 items-center justify-end bg-transparent [-webkit-app-region:no-drag]"
        data-no-drag
        role="toolbar"
      >
        <div
          className="flex h-full translate-y-[-2px] items-center bg-transparent opacity-0 transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 [-webkit-app-region:no-drag]"
          data-no-drag
        >
          <HeaderPinButton />
        </div>
      </div>
    </TooltipProvider>,
    document.body,
  );
}
