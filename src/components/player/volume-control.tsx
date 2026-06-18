import { Volume1, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type PointerEvent as ReactPointerEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useShortcutHint } from "@/hooks/use-shortcut-hint";
import { volumeFromPointerY } from "@/lib/player-hints";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Dock/transport volume control: an icon button that, on hover or keyboard
 * focus, reveals a vertical slider popover (rounded track + `--primary` fill +
 * dot thumb, per the design). Dragging or clicking the track sets the volume;
 * the global `↑/↓` shortcuts adjust it too (shown as the popover's hint, so the
 * control doubles as its own label+Kbd tooltip — no second floating layer).
 *
 * Subscribes to only `volume` so unrelated player state (progress, queue) never
 * re-renders it.
 */
export function VolumeControl({ className }: { className?: string }) {
  const { t } = useTranslation();
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);

  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const lastAudibleVolume = useRef(volume > 0 ? volume : 0.9);
  const labelId = useId();

  function show() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  }
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (volume > 0) lastAudibleVolume.current = volume;
  }, [volume]);

  function setFromPointer(e: ReactPointerEvent) {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setVolume(volumeFromPointerY(e.clientY, rect.top, rect.height));
  }

  const Icon = volume <= 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const pct = Math.round(volume * 100);
  const hint = useShortcutHint()("volume");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover/focus-intent wrapper; the button is keyboard-focusable and the global ↑/↓ shortcuts adjust volume
    <div
      className={cn("relative shrink-0", className)}
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
      onFocus={show}
      onBlur={scheduleClose}
    >
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.94 }}
            transition={{ duration: 0.14 }}
            className="absolute bottom-full left-1/2 z-50 mb-2 flex -translate-x-1/2 flex-col items-center gap-2 rounded-2xl bg-popover p-3 shadow-lg ring-1 ring-border/50"
          >
            {/* Vertical track: top = loud. Click/drag anywhere on it sets volume. */}
            {/* biome-ignore lint/a11y/useFocusableInteractive: focus lives on the trigger button; this track is a pointer affordance mirrored by the global ↑/↓ shortcuts */}
            <div
              ref={trackRef}
              role="slider"
              aria-label={t("player.volume")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-labelledby={labelId}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setFromPointer(e);
              }}
              onPointerMove={(e) => {
                if (e.buttons & 1) setFromPointer(e);
              }}
              className="relative h-28 w-2 cursor-pointer touch-none rounded-full bg-secondary"
            >
              <div
                className="absolute inset-x-0 bottom-0 rounded-full bg-primary"
                style={{ height: `${pct}%` }}
              />
              <div
                className="-translate-x-1/2 absolute left-1/2 size-3.5 rounded-full bg-primary shadow ring-2 ring-popover"
                style={{ bottom: `calc(${pct}% - 0.4375rem)` }}
              />
            </div>
            <div id={labelId} className="flex flex-col items-center gap-1">
              <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                {pct}%
              </span>
              <KbdGroup>
                {hint.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </KbdGroup>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setVolume(volume > 0 ? 0 : lastAudibleVolume.current)}
        aria-label={t("player.volume")}
        title={t("player.volume")}
        className={cn(
          "grid size-9 place-items-center rounded-full text-muted-foreground outline-none transition-colors",
          "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Icon className="size-5" />
      </button>
    </div>
  );
}
