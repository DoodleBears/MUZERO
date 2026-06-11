import { useEffect } from "react";
import { useSettings } from "@/hooks/use-app-data";
import { resolveAppIcon } from "@/lib/app-icon";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";

/**
 * Apply the user's chosen desktop app icon to the running shell — on boot and
 * whenever the Settings → Appearance choice changes. Electron-only: web/tauri
 * bridges omit `setAppIcon`, so this is a no-op there. The Electron main process
 * already shows the dark default at launch; this refines it to the saved variant
 * once settings load.
 */
export function useAppIcon(): void {
  const appIcon = resolveAppIcon(useSettings().appIcon);
  useEffect(() => {
    void resolveDesktopBridge().setAppIcon?.(appIcon);
  }, [appIcon]);
}
