import { Lock, LockOpen, Pause, PinOff, Play, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { saveSettings } from "@/db/repositories";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { useDesktopWindowStore } from "@/stores/desktop-window-store";
import { usePlayerStore } from "@/stores/player-store";

/**
 * In-overlay unpin affordance for the pinned lyrics overlay. While the window is
 * pinned as a lyrics-only capture the chrome stays hidden, so the header pin
 * control is hard to reach; this floats over the lyrics and reveals on pointer
 * activity (`revealed`), mirroring the header's reveal-on-hover rule. A click
 * releases the pin via an absolute `setPinMode("off")` and persists it, matching
 * how the header button unpins. The adjacent Lock button is the explicit
 * click-through control; normal pinning stays interactive.
 */
export function FloatingUnpinButton({ revealed }: { revealed: boolean }) {
  const { t } = useTranslation();
  const init = useDesktopWindowStore((s) => s.init);
  const pinMode = useDesktopWindowStore((s) => s.pinMode);
  const pinSupported = useDesktopWindowStore((s) => s.pinSupported);
  const setClickThroughRegions = useDesktopWindowStore((s) => s.setClickThroughRegions);
  const setPinMode = useDesktopWindowStore((s) => s.setPinMode);
  const pauseClickThrough = useDesktopWindowStore((s) => s.setClickThroughPaused);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const clickThroughPausedRef = useRef(false);
  const locked = pinMode === "pin-click-through";

  const setClickThroughPaused = useCallback(
    (paused: boolean) => {
      if (clickThroughPausedRef.current === paused) return;
      clickThroughPausedRef.current = paused;
      pauseClickThrough(paused);
    },
    [pauseClickThrough],
  );

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!pinSupported) return;

    let frame = 0;
    function syncRegion() {
      const rect = controlsRef.current?.getBoundingClientRect();
      if (!rect) {
        setClickThroughRegions([]);
        return;
      }
      setClickThroughRegions([
        {
          height: rect.height,
          width: rect.width,
          x: rect.left,
          y: rect.top,
        },
      ]);
    }

    syncRegion();
    frame = window.requestAnimationFrame(syncRegion);
    window.addEventListener("resize", syncRegion);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncRegion);
      setClickThroughRegions([]);
    };
  }, [pinSupported, setClickThroughRegions]);

  useEffect(() => {
    if (!pinSupported) return;

    function updateFromPoint(point: { x: number; y: number } | null) {
      if (!revealed || !point || !controlsRef.current) {
        setClickThroughPaused(false);
        return;
      }
      const rect = controlsRef.current.getBoundingClientRect();
      const overControls =
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom;
      setClickThroughPaused(overControls);
    }

    function onPointerMove(event: PointerEvent | MouseEvent) {
      const point = { x: event.clientX, y: event.clientY };
      lastPointerRef.current = point;
      updateFromPoint(point);
    }

    function onWindowBlur() {
      setClickThroughPaused(false);
    }

    updateFromPoint(lastPointerRef.current);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("mousemove", onPointerMove, { passive: true });
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("blur", onWindowBlur);
      setClickThroughPaused(false);
    };
  }, [pinSupported, revealed, setClickThroughPaused]);

  if (!pinSupported) return null;

  async function unpin() {
    try {
      setClickThroughPaused(false);
      const state = await setPinMode("off");
      if (!state) return;
      await saveSettings({ desktopWindowPinMode: "off" });
    } catch (error) {
      log.warn("desktop.windowPin", "Unable to unpin window", error);
    }
  }

  async function toggleLock() {
    try {
      const nextMode = locked ? "pin" : "pin-click-through";
      const state = await setPinMode(nextMode);
      if (!state) return;
      await saveSettings({ desktopWindowPinMode: "pin" });
    } catch (error) {
      log.warn("desktop.windowPin", "Unable to update lyrics window lock", error);
    }
  }

  const playLabel = isPlaying ? t("player.pause") : t("player.play");

  return (
    <TooltipProvider>
      <div
        aria-label={t("windowControls.lyricsOverlayControls")}
        className={cn(
          // No backdrop-blur and no box-shadow: over a TRANSPARENT macOS window both
          // are blurred regions painted outside/over the element that Chromium fails
          // to clear, leaving a "残影" ghost. They're not needed for an overlay the
          // user composites anyway — a solid translucent pill keeps controls legible.
          "-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 z-10 flex items-center gap-1.5 rounded-full bg-black/30 p-1 transition duration-200 [-webkit-app-region:no-drag]",
          revealed ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        data-no-drag
        onBlurCapture={() => setClickThroughPaused(false)}
        onFocusCapture={() => setClickThroughPaused(true)}
        onMouseEnter={() => setClickThroughPaused(true)}
        onMouseLeave={() => setClickThroughPaused(false)}
        onPointerCancel={() => setClickThroughPaused(false)}
        onPointerDown={() => setClickThroughPaused(true)}
        ref={controlsRef}
        role="toolbar"
      >
        <ControlTooltip label={t("windowControls.unpin")} side="top">
          <Button
            aria-label={t("windowControls.unpin")}
            className="size-9 rounded-full border border-white/15 bg-black/45 text-white/85 shadow-none transition [-webkit-app-region:no-drag] hover:bg-black/60 hover:text-white"
            data-no-drag
            onClick={() => void unpin()}
            size="icon"
            variant="ghost"
          >
            <PinOff />
          </Button>
        </ControlTooltip>
        <ControlTooltip
          label={
            locked ? t("windowControls.unlockClickThrough") : t("windowControls.lockClickThrough")
          }
          side="top"
        >
          <Button
            aria-label={
              locked ? t("windowControls.unlockClickThrough") : t("windowControls.lockClickThrough")
            }
            aria-pressed={locked}
            className={cn(
              "size-9 rounded-full border border-white/15 bg-black/45 text-white/85 shadow-none transition [-webkit-app-region:no-drag] hover:bg-black/60 hover:text-white",
              locked && "border-primary/70 text-primary ring-1 ring-primary/50",
            )}
            data-no-drag
            onClick={() => void toggleLock()}
            size="icon"
            variant="ghost"
          >
            {locked ? <Lock /> : <LockOpen />}
          </Button>
        </ControlTooltip>
        <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-white/15" />
        <ControlTooltip label={t("player.previous")} side="top">
          <Button
            aria-label={t("player.previous")}
            className="size-9 rounded-full border border-white/15 bg-black/45 text-white/85 shadow-none transition [-webkit-app-region:no-drag] hover:bg-black/60 hover:text-white"
            data-no-drag
            onClick={() => void prev()}
            size="icon"
            variant="ghost"
          >
            <SkipBack />
          </Button>
        </ControlTooltip>
        <ControlTooltip label={playLabel} side="top">
          <Button
            aria-label={playLabel}
            className="size-10 rounded-full border border-white/20 bg-white/90 text-black shadow-none transition [-webkit-app-region:no-drag] hover:bg-white hover:text-black [&_svg]:opacity-100"
            data-no-drag
            onClick={togglePlay}
            size="icon"
            variant="ghost"
          >
            {isPlaying ? <Pause /> : <Play />}
          </Button>
        </ControlTooltip>
        <ControlTooltip label={t("player.next")} side="top">
          <Button
            aria-label={t("player.next")}
            className="size-9 rounded-full border border-white/15 bg-black/45 text-white/85 shadow-none transition [-webkit-app-region:no-drag] hover:bg-black/60 hover:text-white"
            data-no-drag
            onClick={() => void next()}
            size="icon"
            variant="ghost"
          >
            <SkipForward />
          </Button>
        </ControlTooltip>
      </div>
    </TooltipProvider>
  );
}
