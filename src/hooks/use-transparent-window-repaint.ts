import { useEffect, useRef } from "react";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";

// Repaint just after the layer's fade settles (and once more, in case the first
// lands a frame early) so the cleared region is the final, fully-faded state — not
// a half-faded frame. Buffers are added on top of the layer's own fade duration.
const SETTLE_BUFFER_MS = 60;
const SECOND_PASS_BUFFER_MS = 600;
const DEFAULT_FADE_MS = 500;

/**
 * Clear the macOS transparent-window "stale frame" ghost.
 *
 * When a layer over a TRANSPARENT window disappears — the Now Playing background
 * canvas tearing down on pin, or the pinned lyrics control bar fading out — Chromium
 * doesn't reliably repaint the freed region to transparent, so the last painted frame
 * stays stuck on screen (the reported "残影"). Forcing a full window repaint
 * (`webContents.invalidate()`, exposed as `windowControls.repaint`) after the fade
 * settles flushes that stale region.
 *
 * Fires only on the disappearing edge (the only transition that orphans pixels) and
 * only on shells that expose `repaint` (Electron); web/Tauri no-op, Windows just
 * repaints. `fadeMs` should match the layer's own fade so the repaint lands after it.
 */
export function useTransparentWindowRepaint(visible: boolean, options?: { fadeMs?: number }): void {
  const fadeMs = options?.fadeMs ?? DEFAULT_FADE_MS;
  const previousVisible = useRef(visible);

  useEffect(() => {
    const wasVisible = previousVisible.current;
    previousVisible.current = visible;
    // Only a layer that JUST disappeared can leave a stale frame to clear.
    if (wasVisible === visible || visible) return;

    const repaint = resolveDesktopBridge().windowControls?.repaint;
    if (!repaint) return;

    const first = window.setTimeout(() => void repaint(), fadeMs + SETTLE_BUFFER_MS);
    const second = window.setTimeout(() => void repaint(), fadeMs + SECOND_PASS_BUFFER_MS);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [visible, fadeMs]);
}

/**
 * Keep an UNFOCUSED transparent window recompositing while `active`.
 *
 * A focused macOS window composites (and clears) continuously, but an UNFOCUSED
 * transparent window stops — so moving lyrics smear into a "残影" the moment focus
 * leaves (the usual state for a desktop/OBS overlay). `webContents.invalidate()` is
 * too weak to force an unfocused recomposite; a tiny `setOpacity` nudge IS (the same
 * recomposite focusing triggers). That loop runs in the MAIN process so it's immune
 * to renderer / focus throttling — this hook just toggles it on/off.
 *
 * Use ONLY while content is actually moving (lyrics playing in the transparent
 * capture). No-op on shells without the control (web/Tauri).
 */
export function useContinuousTransparentRepaint(active: boolean): void {
  useEffect(() => {
    const setContinuousRepaint = resolveDesktopBridge().windowControls?.setContinuousRepaint;
    if (!setContinuousRepaint || !active) return;
    void setContinuousRepaint(true);
    return () => {
      void setContinuousRepaint(false);
    };
  }, [active]);
}
