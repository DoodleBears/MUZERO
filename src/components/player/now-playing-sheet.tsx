import {
  ChevronDown,
  Pause,
  Play,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AuraVisualizer } from "@/components/player/aura-visualizer";
import { ProgressScrubber } from "@/components/player/progress-scrubber";
import { AnnotationEditor } from "@/components/track/annotation-editor";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { trackSubtitle } from "@/lib/track-display";
import { nextRepeatMode } from "@/player/transport";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";

/**
 * Mobile full-screen Now Playing surface. Expands from the dock's mini player
 * (the cover is a shared `layoutId` element). Carries the full transport that
 * the collapsed dock omits. Deliberately does NOT mount the persistent <video>
 * (MediaEngine owns a single element; a second mount would steal it from the
 * desktop stage) — it shows the cover, or the analyser visualizer as a fallback.
 * Showing live video in the sheet is a later enhancement.
 */
export function NowPlayingSheet() {
  const isSheetOpen = useUiStore((s) => s.isSheetOpen);
  return <AnimatePresence>{isSheetOpen && <SheetBody />}</AnimatePresence>;
}

function SheetBody() {
  const { t } = useTranslation();
  const closeSheet = useUiStore((s) => s.closeSheet);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const repeat = usePlayerStore((s) => s.repeat);
  const volume = usePlayerStore((s) => s.volume);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const setVolume = usePlayerStore((s) => s.setVolume);

  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const coverUrl = useTrackCoverUrl(current);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape, and move focus into the dialog when it opens (a11y).
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSheet]);

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("nav.now")}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-background outline-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-center p-3">
        <Button variant="ghost" size="icon" onClick={closeSheet} aria-label={t("nav.now")}>
          <ChevronDown />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto px-5 pb-10">
        <motion.div
          layoutId="now-cover"
          className="relative aspect-square w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card"
        >
          {coverUrl ? (
            <img src={coverUrl} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <AuraVisualizer active={isPlaying} className="absolute inset-0" />
          )}
        </motion.div>

        <div className="w-full max-w-sm">
          <div className="truncate text-xl font-semibold">{current?.title ?? "MUZERO"}</div>
          <div className="truncate text-sm text-muted-foreground">
            {current ? trackSubtitle(current) : t("app.pressPlay")}
          </div>
        </div>

        <div className="w-full max-w-sm">
          <ProgressScrubber />
        </div>

        <div className="flex w-full max-w-sm items-center justify-center gap-6">
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={() => void prev()}
            aria-label={t("player.previous")}
          >
            <SkipBack />
          </Button>
          <Button
            size="icon-xl"
            onClick={togglePlay}
            aria-label={isPlaying ? t("player.pause") : t("player.play")}
            className="rounded-full"
          >
            {isPlaying ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={() => void next()}
            aria-label={t("player.next")}
          >
            <SkipForward />
          </Button>
        </div>

        <div className="flex w-full max-w-sm items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setRepeat(nextRepeatMode(repeat))}
            aria-label={t("player.repeat", { mode: repeat })}
            className={repeat !== "off" ? "text-primary" : undefined}
          >
            {repeat === "one" ? <Repeat1 /> : <Repeat />}
          </Button>
          <Volume2 className="size-4 shrink-0 text-muted-foreground" />
          <Slider
            value={volume * 100}
            onValueChange={(v) => setVolume(v / 100)}
            aria-label={t("player.volume")}
            className="flex-1"
          />
        </div>

        {current && (
          <div className="w-full max-w-sm">
            <AnnotationEditor key={current.id} track={current} />
          </div>
        )}
      </div>
    </motion.div>
  );
}
