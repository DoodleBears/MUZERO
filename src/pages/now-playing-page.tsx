import {
  Headphones,
  Image as ImageIcon,
  PlayCircle,
  Repeat,
  Repeat1,
  Shuffle,
  Type,
  Video,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DjConsole } from "@/components/dj/dj-console";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { MediaStage } from "@/components/player/media-stage";
import { NowPlayingPanel } from "@/components/player/now-playing-panel";
import { PlaybackSpectrum } from "@/components/player/playback-spectrum";
import { TrackInfoCard } from "@/components/player/track-info-card";
import { TransportControls } from "@/components/player/transport-controls";
import { VisualizerModeButton } from "@/components/player/visualizer-mode-button";
import { AnnotationEditor } from "@/components/track/annotation-editor";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SetDisplayMode } from "@/db/types";
import { cn } from "@/lib/utils";
import { nextRepeatMode } from "@/player/transport";
import { usePlayerStore } from "@/stores/player-store";

const DISPLAY_MODES: { id: SetDisplayMode; icon: typeof Video }[] = [
  { id: "video", icon: Video },
  { id: "cover", icon: ImageIcon },
  { id: "title", icon: Type },
];

/**
 * Now Playing, YouTube-Music style: a wide media area (16:9 for video, a square
 * for audio art) with a track-info card below, and a tabbed queue/lyrics rail on
 * the right (desktop). The ambient slideshow background lives at the app root.
 */
export function NowPlayingPage() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const djEnabled = usePlayerStore((s) => s.djEnabled);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;

  // Reset the scroll to the top when the track changes (the new media/info
  // should be in view), not used as a render value.
  const sectionRef = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: track id is the reset trigger, not read in the body
  useEffect(() => {
    sectionRef.current?.scrollTo({ top: 0 });
  }, [current?.id]);

  return (
    // Columns are full-bleed (no top reserve) and pad themselves with
    // scroll-padding, so content rests below the bars at rest but scrolls up
    // *under* them.
    <div className="h-full">
      <div className="mx-auto grid h-full w-full max-w-[1680px] gap-6 px-4 lg:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section
          ref={sectionRef}
          className="no-scrollbar flex min-h-0 flex-col gap-4 overflow-y-auto pt-chrome-top pb-chrome-bottom"
        >
          {/* Video fills the width at its own aspect ratio; audio shows a square. */}
          <MediaStage />

          {current && <TrackInfoCard track={current} />}

          <NowPlayingActionRow />

          <div className="relative mx-auto w-full max-w-2xl py-0">
            <PlaybackSpectrum className="-translate-y-1/2 absolute inset-x-0 top-1/2" />
            <TransportControls className="relative z-10 py-4 " />
          </div>

          {current && <AnnotationEditor key={current.id} track={current} />}

          {djEnabled && <DjConsole />}
        </section>

        <aside className="hidden min-h-0 pt-chrome-top xl:block">
          <NowPlayingPanel />
        </aside>
      </div>
    </div>
  );
}

function NowPlayingActionRow() {
  const { t } = useTranslation();
  const displayMode = usePlayerStore((s) => s.displayMode);
  const audioOnly = usePlayerStore((s) => s.audioOnly);
  const autoplay = usePlayerStore((s) => s.autoplay);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const setDisplayMode = usePlayerStore((s) => s.setDisplayMode);
  const setAudioOnly = usePlayerStore((s) => s.setAudioOnly);
  const setAutoplay = usePlayerStore((s) => s.setAutoplay);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const setShuffle = usePlayerStore((s) => s.setShuffle);

  return (
    <TooltipProvider>
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-full bg-card/70 p-1 shadow-sm">
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
                    displayMode === id
                      ? "bg-accent text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Button>
              </ControlTooltip>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-full bg-card/70 p-1 shadow-sm">
          <VisualizerModeButton className="size-9" />
          <ControlTooltip label={t("player.autoplay")}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setAutoplay(!autoplay)}
              aria-label={t("player.autoplay")}
              aria-pressed={autoplay}
              className={cn(
                "size-9 rounded-full",
                autoplay ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <PlayCircle />
            </Button>
          </ControlTooltip>
          <ControlTooltip label={t("nowPlaying.audioOnlyHint")}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setAudioOnly(!audioOnly)}
              aria-label={t("nowPlaying.audioOnly")}
              aria-pressed={audioOnly}
              className={cn(
                "size-9 rounded-full",
                audioOnly ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Headphones />
            </Button>
          </ControlTooltip>
          <ControlTooltip label={t("player.repeatLabel")}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRepeat(nextRepeatMode(repeat))}
              aria-label={t("player.repeat", { mode: repeat })}
              aria-pressed={repeat !== "off"}
              className={cn(
                "size-9 rounded-full",
                repeat !== "off" ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {repeat === "one" ? <Repeat1 /> : <Repeat />}
            </Button>
          </ControlTooltip>
          <ControlTooltip label={t("player.shuffle")}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShuffle(!shuffle)}
              aria-label={t("player.shuffle")}
              aria-pressed={shuffle}
              className={cn(
                "size-9 rounded-full",
                shuffle ? "text-primary" : "text-muted-foreground hover:text-foreground",
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
