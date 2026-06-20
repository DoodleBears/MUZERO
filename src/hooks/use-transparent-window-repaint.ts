import { useEffect, useRef } from "react";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";

// The ambient background fades over 500ms (App.tsx). Repaint just after it settles
// (and once more, in case the first lands a frame early) so the cleared region is
// the final, fully-faded state — not a half-faded frame.
const FADE_SETTLE_MS = 560;
const SECOND_PASS_MS = 1120;

/**
 * Clear the macOS transparent-window "stale frame" ghost.
 *
 * When the Now Playing background is torn down (e.g. on pin → lyrics-only), its
 * heavy Pixi/visualizer/canvas layer unmounts. On a TRANSPARENT window Chromium
 * doesn't reliably repaint the freed region to transparent, so the last painted
 * frame stays stuck on screen — the "固定的残影" reported once the background fades.
 *
 * Forcing a full window repaint (`webContents.invalidate()`, exposed as
 * `windowControls.repaint`) after the fade settles flushes that stale region. We
 * only do it on the disappearing edge — that's the only transition that leaves
 * orphaned pixels — and only on shells that expose `repaint` (Electron); web/Tauri
 * no-op. Harmless on Windows (just a repaint).
 */
export function useTransparentWindowRepaint(backgroundActive: boolean): void {
  const previousActive = useRef(backgroundActive);

  useEffect(() => {
    const wasActive = previousActive.current;
    previousActive.current = backgroundActive;
    // Only a background that JUST disappeared can leave a stale frame to clear.
    if (wasActive === backgroundActive || backgroundActive) return;

    const repaint = resolveDesktopBridge().windowControls?.repaint;
    if (!repaint) return;

    const first = window.setTimeout(() => void repaint(), FADE_SETTLE_MS);
    const second = window.setTimeout(() => void repaint(), SECOND_PASS_MS);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [backgroundActive]);
}
