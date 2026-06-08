import { Grip, Image, SlidersHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { VisualizerTuningControls } from "@/components/player/visualizer-tuning-controls";
import { BackgroundEffectControls } from "@/components/settings/background-effect-controls";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { useVisualizerPanelStore } from "@/stores/visualizer-panel-store";
import { resolveVisualizerStyle, VISUALIZER_META } from "@/visualizer/registry";
import type { VisualizerStyleId } from "@/visualizer/types";

const PANEL_W = 360;
const PANEL_H = 560;
type TuningTab = "visualizer" | "background";

export function VisualizerTuningPanel() {
  const { t } = useTranslation();
  const open = useVisualizerPanelStore((s) => s.open);
  const previewOnly = useVisualizerPanelStore((s) => s.previewOnly);
  const visualizerHidden = useVisualizerPanelStore((s) => s.visualizerHidden);
  const setOpen = useVisualizerPanelStore((s) => s.setOpen);
  const setPreviewOnly = useVisualizerPanelStore((s) => s.setPreviewOnly);
  const setVisualizerHidden = useVisualizerPanelStore((s) => s.setVisualizerHidden);
  const settings = useSettings();
  const style = resolveVisualizerStyle(settings.visualizerStyle);
  const [pos, setPos] = useState({ x: 24, y: 88 });
  const [tab, setTab] = useState<TuningTab>("visualizer");
  const dragRef = useRef<{
    dx: number;
    dy: number;
    frame: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPos((p) => clampPanelPosition(p.x, p.y));
  }, [open]);

  useEffect(() => {
    if (open) return;
    setPreviewOnly(false);
    setVisualizerHidden(false);
  }, [open, setPreviewOnly, setVisualizerHidden]);

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
      aria-label={t("visualizer.panelTitle")}
      className="fixed z-[85] flex max-h-[min(560px,calc(100vh-2rem))] w-[min(360px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border bg-card/95 text-card-foreground shadow-2xl backdrop-blur-xl"
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
        <SlidersHorizontal className="size-4 text-primary" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {t("visualizer.panelTitle")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setOpen(false)}
          aria-label={t("visualizer.closePanel")}
          className="size-8 rounded-full"
        >
          <X />
        </Button>
      </div>

      <div className="no-scrollbar flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/30 p-1">
          <TabButton active={tab === "visualizer"} onClick={() => setTab("visualizer")}>
            <SlidersHorizontal className="size-3.5" />
            {t("visualizer.title")}
          </TabButton>
          <TabButton active={tab === "background"} onClick={() => setTab("background")}>
            <Image className="size-3.5" />
            {t("background.title")}
          </TabButton>
        </div>

        {tab === "visualizer" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("visualizer.style")}
              </span>
              <Select
                value={style}
                onValueChange={(value) =>
                  void saveSettings({ visualizerStyle: value as VisualizerStyleId })
                }
              >
                <SelectTrigger>
                  <SelectValue>
                    {(value) =>
                      t(
                        VISUALIZER_META.find((item) => item.id === value)?.labelKey ??
                          "visualizer.style",
                      )
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {VISUALIZER_META.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {t(m.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={previewOnly}
                onChange={(e) => setPreviewOnly(e.target.checked)}
                className="size-4 accent-[var(--color-primary)]"
              />
              {t("visualizer.previewOnly")}
            </label>
            <p className="-mt-1 text-xs text-muted-foreground">{t("visualizer.previewOnlyHint")}</p>

            <div className="grid grid-cols-2 gap-2">
              <ToggleButton
                active={settings.visualizerAsBackground ?? false}
                onClick={() =>
                  void saveSettings({
                    visualizerAsBackground: !(settings.visualizerAsBackground ?? false),
                  })
                }
              >
                {t("visualizer.modeBackground")}
              </ToggleButton>
              <ToggleButton
                active={settings.visualizerIdleOnly ?? false}
                onClick={() =>
                  void saveSettings({
                    visualizerIdleOnly: !(settings.visualizerIdleOnly ?? false),
                  })
                }
              >
                {t("visualizer.idleOnlyShort")}
              </ToggleButton>
            </div>

            <VisualizerTuningControls className="grid gap-3 border-border border-t pt-3" />
          </>
        ) : (
          <>
            <div className="grid gap-2 rounded-lg border border-border/70 bg-background/30 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={previewOnly}
                  onChange={(e) => setPreviewOnly(e.target.checked)}
                  className="size-4 accent-[var(--color-primary)]"
                />
                {t("visualizer.previewOnly")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={visualizerHidden}
                  onChange={(e) => setVisualizerHidden(e.target.checked)}
                  className="size-4 accent-[var(--color-primary)]"
                />
                {t("visualizer.hideBackgroundVisualizer")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("visualizer.backgroundPreviewHint")}
              </p>
            </div>
            <BackgroundEffectControls />
          </>
        )}
      </div>
    </section>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 items-center justify-center gap-1.5 rounded-md px-2 font-medium text-sm transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ToggleButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 rounded-md border px-2 text-sm transition-colors",
        active
          ? "border-primary/50 bg-primary/12 text-primary"
          : "border-border bg-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function clampPanelPosition(x: number, y: number) {
  if (typeof window === "undefined") return { x, y };
  return {
    x: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - PANEL_W - 12)),
    y: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - PANEL_H - 12)),
  };
}
