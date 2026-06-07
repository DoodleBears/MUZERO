import { Image as ImageIcon, Repeat, Repeat1, Shuffle, Video } from "lucide-react";
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DjConsole } from "@/components/dj/dj-console";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { NowPlayingPanel } from "@/components/player/now-playing-panel";
import { PlaybackSpectrum } from "@/components/player/playback-spectrum";
import { SwipeableMediaStage } from "@/components/player/swipeable-media-stage";
import { TrackInfoCard } from "@/components/player/track-info-card";
import { TransportControls } from "@/components/player/transport-controls";
import { VisualizerModeButton } from "@/components/player/visualizer-mode-button";
import { AnnotationEditor } from "@/components/track/annotation-editor";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { addTrackBackground, saveSettings, setTrackCover } from "@/db/repositories";
import type { SetDisplayMode } from "@/db/types";
import { classifyDrop, dragHasFiles, filesFromTransfer, summarizeDragItems } from "@/lib/file-drop";
import { playerShortcutHint } from "@/lib/player-hints";
import { isMac } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { nextRepeatMode } from "@/player/transport";
import { usePlayerStore } from "@/stores/player-store";
import { useVisualizerPanelStore } from "@/stores/visualizer-panel-store";

const DISPLAY_MODES: { id: SetDisplayMode; icon: typeof Video }[] = [
  { id: "video", icon: Video },
  { id: "cover", icon: ImageIcon },
];
const GLASS_CONTROL_GROUP =
  "rounded-full border border-white/10 bg-black/35 p-1 shadow-lg backdrop-blur-md";
const GLASS_CONTROL_ACTIVE =
  "bg-black/45 text-white shadow-sm hover:bg-black/50 data-pressed:bg-black/55";
const GLASS_CONTROL_IDLE =
  "text-white/55 hover:bg-white/10 hover:text-white data-pressed:bg-white/10";

/**
 * Now Playing, YouTube-Music style: a wide media area (16:9 for video, a square
 * for audio art) with a track-info card below, and a tabbed queue/lyrics rail on
 * the right (desktop). The ambient slideshow background lives at the app root.
 */
export function NowPlayingPage() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const djEnabled = usePlayerStore((s) => s.djEnabled);
  const visualizerPreviewOnly = useVisualizerPanelStore((s) => s.previewOnly);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;

  // Reset the scroll to the top when the track changes (the new media/info
  // should be in view), not used as a render value.
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: track id is the reset trigger, not read in the body
  useEffect(() => {
    sectionRef.current?.scrollTo({ top: 0 });
  }, [current?.id]);

  return (
    // Columns are full-bleed (no top reserve) and pad themselves with
    // scroll-padding, so content rests below the bars at rest but scrolls up
    // *under* them.
    <div className="h-full">
      <NowPlayingImageDropLayer current={current} stageRef={stageRef} />
      <div
        className={cn(
          "sm:mx-8 lg:mx-12 grid h-full gap-6 px-4 transition-opacity duration-200 lg:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]",
          visualizerPreviewOnly && "pointer-events-none opacity-0",
        )}
      >
        <section
          ref={sectionRef}
          className="no-scrollbar flex min-h-0 flex-col gap-3 overflow-y-auto pt-chrome-top pb-chrome-bottom"
        >
          {/* Video fills the width at its own aspect ratio; audio shows a square. */}
          <div ref={stageRef}>
            <SwipeableMediaStage />
          </div>

          {current && <TrackInfoCard track={current} />}

          <NowPlayingActionRow />

          <div className="relative mx-auto w-full py-0">
            <PlaybackSpectrum className="-translate-y-1/2 absolute inset-x-0 top-1/2" />
            <TransportControls className="relative z-10 py-4 " />
          </div>

          {current && <AnnotationEditor key={current.id} track={current} />}

          {djEnabled && <DjConsole />}
        </section>

        <aside className="hidden min-h-0 pt-chrome-top md:block">
          <NowPlayingPanel collapsible />
        </aside>
      </div>
    </div>
  );
}

type ImageDropTarget = "cover" | "background";

function NowPlayingImageDropLayer({
  current,
  stageRef,
}: {
  current: ReturnType<typeof usePlayerStore.getState>["queue"][number] | undefined;
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<ImageDropTarget | null>(null);
  const [notice, setNotice] = useState<ImageDropTarget | null>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    function eventIsImageDrag(e: DragEvent) {
      if (!current || !dragHasFiles(e.dataTransfer?.types)) return false;
      return summarizeDragItems(e.dataTransfer?.items).allImages;
    }

    function targetFromPoint(e: DragEvent): ImageDropTarget {
      const rect = stageRef.current?.getBoundingClientRect();
      if (
        rect &&
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        return "cover";
      }
      return "background";
    }

    function stop(e: DragEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    function onDragEnter(e: DragEvent) {
      if (!eventIsImageDrag(e)) return;
      stop(e);
      dragDepth.current += 1;
      setTarget(targetFromPoint(e));
    }

    function onDragOver(e: DragEvent) {
      if (!eventIsImageDrag(e)) return;
      stop(e);
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setTarget(targetFromPoint(e));
    }

    function onDragLeave(e: DragEvent) {
      if (!eventIsImageDrag(e)) return;
      stop(e);
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setTarget(null);
    }

    function onDrop(e: DragEvent) {
      if (!eventIsImageDrag(e) || !current) return;
      stop(e);
      dragDepth.current = 0;
      const dropTarget = targetFromPoint(e);
      setTarget(null);
      const { images } = classifyDrop(filesFromTransfer(e.dataTransfer));
      const image = images[0];
      if (!image) return;
      if (dropTarget === "cover") {
        void setTrackCover({
          trackId: current.id,
          blob: image,
          mime: image.type || "image/jpeg",
        }).then(() => setNotice("cover"));
      } else {
        void Promise.all([
          addTrackBackground({
            trackId: current.id,
            blob: image,
            mime: image.type || "image/jpeg",
          }),
          saveSettings({ backgroundMode: "slideshow" }),
        ]).then(() => setNotice("background"));
      }
    }

    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragleave", onDragLeave, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onDragEnter, true);
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("dragleave", onDragLeave, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, [current, stageRef]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[75]">
      {target ? (
        <div className="absolute inset-0 bg-background/20 backdrop-blur-[2px]">
          <div
            className={cn(
              "absolute rounded-2xl border-2 border-dashed transition-colors",
              target === "cover"
                ? "border-primary bg-primary/12"
                : "border-border/70 bg-background/10",
            )}
            style={stageOverlayStyle(stageRef.current)}
          >
            <div className="absolute inset-0 grid place-items-center p-4 text-center">
              <span className="rounded-full border border-primary/30 bg-card/95 px-4 py-2 font-medium text-primary text-sm shadow-lg">
                {t("drop.dropAsCover")}
              </span>
            </div>
          </div>
          <div
            className={cn(
              "absolute inset-3 rounded-3xl border-2 border-dashed transition-colors",
              target === "background"
                ? "border-primary bg-primary/12"
                : "border-border/50 bg-transparent",
            )}
          >
            <div className="absolute right-4 bottom-[calc(var(--spacing-chrome-bottom,0px)+1rem)] rounded-full border border-primary/30 bg-card/95 px-4 py-2 font-medium text-primary text-sm shadow-lg">
              {t("drop.dropAsTrackBackground")}
            </div>
          </div>
        </div>
      ) : null}
      {notice ? (
        <div className="absolute bottom-[calc(var(--spacing-chrome-bottom,0px)+1rem)] left-1/2 -translate-x-1/2 rounded-full border bg-card px-4 py-2 text-sm shadow-lg">
          {notice === "cover" ? t("drop.coverApplied") : t("drop.bgApplied")}
        </div>
      ) : null}
    </div>
  );
}

function stageOverlayStyle(el: HTMLDivElement | null): CSSProperties {
  if (!el) return { inset: "1rem" };
  const rect = el.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function NowPlayingActionRow() {
  const { t } = useTranslation();
  const displayMode = usePlayerStore((s) => s.displayMode);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const setDisplayMode = usePlayerStore((s) => s.setDisplayMode);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const mac = isMac();

  return (
    <TooltipProvider>
      <div className="mx-auto flex w-full flex-wrap items-center justify-between gap-2">
        <div className={cn("flex", GLASS_CONTROL_GROUP)}>
          {DISPLAY_MODES.map(({ id, icon: Icon }) => {
            const label = t(`displayMode.${id}`);
            return (
              <ControlTooltip key={id} label={t("nowPlaying.modeTitle", { mode: label })}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void setDisplayMode(id)}
                  aria-label={t("nowPlaying.modeTitle", { mode: label })}
                  aria-pressed={displayMode === id}
                  className={cn(
                    "rounded-full border-0 px-2.5 shadow-none",
                    displayMode === id ? GLASS_CONTROL_ACTIVE : GLASS_CONTROL_IDLE,
                  )}
                >
                  <Icon className="size-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Button>
              </ControlTooltip>
            );
          })}
        </div>

        <div className={cn("flex items-center gap-1", GLASS_CONTROL_GROUP)}>
          <VisualizerModeButton className="size-9" />
          <ControlTooltip label={t("player.repeatLabel")} keys={playerShortcutHint("repeat", mac)}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRepeat(nextRepeatMode(repeat))}
              aria-label={t("player.repeat", { mode: repeat })}
              aria-pressed={repeat !== "off"}
              className={cn(
                "size-9 rounded-full border-0",
                repeat !== "off" ? GLASS_CONTROL_ACTIVE : GLASS_CONTROL_IDLE,
              )}
            >
              {repeat === "one" ? <Repeat1 /> : <Repeat />}
            </Button>
          </ControlTooltip>
          <ControlTooltip label={t("player.shuffle")} keys={playerShortcutHint("shuffle", mac)}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShuffle(!shuffle)}
              aria-label={t("player.shuffle")}
              aria-pressed={shuffle}
              className={cn(
                "size-9 rounded-full border-0",
                shuffle ? GLASS_CONTROL_ACTIVE : GLASS_CONTROL_IDLE,
              )}
            >
              <Shuffle />
            </Button>
          </ControlTooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
