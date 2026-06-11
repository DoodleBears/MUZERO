import { useEffect } from "react";
import { useSettings } from "@/hooks/use-app-data";
import { persistAppIcon, resolveAppIcon } from "@/lib/app-icon";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";

/**
 * Apply the user's chosen logo to the browser favicon and, when available, the
 * running Electron shell. Tauri/web bridges omit `setAppIcon`, so the desktop
 * part is a no-op there.
 */
export function useAppIcon(): void {
  const appIcon = resolveAppIcon(useSettings().appIcon);
  useEffect(() => {
    persistAppIcon(appIcon);
    void resolveDesktopBridge().setAppIcon?.(appIcon);
  }, [appIcon]);
}
