import { Captions, Grip, X } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LyricsTuningControls } from "@/components/player/lyrics-tuning-controls";
import { Button } from "@/components/ui/button";
import { useLyricsPanelStore } from "@/stores/lyrics-panel-store";

const PANEL_W = 340;
const PANEL_H = 480;

/**
 * Floating, draggable lyrics-appearance panel — the lyrics twin of the visualizer
 * tuning panel. Opened from the lyrics-mode button (long-press / right-click) so
 * you can tune lyrics live on the Now-Playing page instead of leaving for
 * Settings. Mounted once from App.
 */
export function LyricsTuningPanel() {
  const { t } = useTranslation();
  const open = useLyricsPanelStore((s) => s.open);
  const setOpen = useLyricsPanelStore((s) => s.setOpen);
  const [pos, setPos] = useState({ x: 24, y: 88 });
  const dragRef = useRef<{ dx: number; dy: number; frame: number; x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    setPos((p) => clampPanelPosition(p.x, p.y));
  }, [open]);

  if (!open) return null;

  function beginDrag(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      dx: e.clientX - pos.x,
      dy: e.clientY - pos.y,
      frame: 0,
      x: pos.x,
      y: pos.y,
    };
  }

  function moveDrag(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !(e.buttons & 1)) return;
    const next = clampPanelPosition(e.clientX - drag.dx, e.clientY - drag.dy);
    drag.x = next.x;
    drag.y = next.y;
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      const latest = dragRef.current;
      if (!latest) return;
      latest.frame = 0;
      setPos({ x: latest.x, y: latest.y });
    });
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const frame = dragRef.current?.frame;
    if (frame) cancelAnimationFrame(frame);
    dragRef.current = null;
  }

  return (
    <section
      role="dialog"
      aria-label={t("lyricsSettings.title")}
      className="fixed z-[85] flex max-h-[min(480px,calc(100vh-2rem))] w-[min(340px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border bg-card/95 text-card-foreground shadow-2xl backdrop-blur-xl"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="flex select-none items-center gap-2 border-border border-b px-3 py-2">
        <div
          className="-ml-1 grid size-8 cursor-grab touch-none place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 active:cursor-grabbing"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <Grip className="size-4" />
        </div>
        <Captions className="size-4 text-primary" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {t("lyricsSettings.title")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setOpen(false)}
          aria-label={t("drop.close")}
          className="size-8 rounded-full"
        >
          <X />
        </Button>
      </div>

      <div className="no-scrollbar min-h-0 overflow-y-auto p-3">
        <LyricsTuningControls />
      </div>
    </section>
  );
}

function clampPanelPosition(x: number, y: number) {
  if (typeof window === "undefined") return { x, y };
  return {
    x: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - PANEL_W - 12)),
    y: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - PANEL_H - 12)),
  };
}
