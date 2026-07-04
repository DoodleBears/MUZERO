import { MapPin } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { Memory } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { useScheduledMemory } from "@/hooks/use-scheduled-memory";
import { formatDuration } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Presentational memory card for the lyrics strip. Unlike the passive immersive
 * overlay, the `atSec` badge is tappable (seek to that second — mirrors tap-a-lyric).
 */
export function MemoryStripCard({
  memory,
  photoUrl,
  onSeek,
}: {
  memory: Memory;
  photoUrl?: string;
  onSeek?: (sec: number) => void;
}) {
  const { t } = useTranslation();
  const atSec = memory.atSec;
  return (
    <motion.div
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      className="pointer-events-auto max-w-md rounded-2xl border border-border/60 bg-background/70 px-4 py-2.5 text-center shadow-lg backdrop-blur-md"
      data-testid="lyrics-memory-card"
      exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
      initial={{ opacity: 0, y: -8, filter: "blur(6px)" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {photoUrl && (
        <img
          alt=""
          className="mx-auto mb-2 max-h-24 w-auto rounded-lg object-contain"
          src={photoUrl}
        />
      )}
      <p className="line-clamp-3 whitespace-pre-wrap break-words font-medium text-sm">
        {memory.note}
      </p>
      <div className="mt-1 flex items-center justify-center gap-2 text-muted-foreground text-xs">
        {atSec != null && onSeek && (
          <button
            aria-label={t("annotation.seekToMemoryTime", {
              defaultValue: "Jump to {{time}}",
              time: formatDuration(atSec),
            })}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-primary transition-colors hover:bg-primary/20"
            data-testid="lyrics-memory-seek"
            onClick={() => onSeek(atSec)}
            type="button"
          >
            <MapPin className="size-3" />
            {formatDuration(atSec)}
          </button>
        )}
        {memory.author?.displayName && <span>—— {memory.author.displayName}</span>}
      </div>
    </motion.div>
  );
}

/**
 * Top-of-lyrics memory carousel: while lyrics are shown, surface this track's memories
 * as a top strip — same schedule as full-immersive ({@link useScheduledMemory}), so an
 * anchored comment appears over its lyric moment. Gated by `lyricsMemoryOverlay` (visible
 * Settings toggle, default on) and `showMemoryStrip` (off for the immersive lyrics overlay,
 * which already has its own memory popover). Idle when disabled — no schedule tick.
 */
export function LyricsMemoryStrip({ showMemoryStrip = true }: { showMemoryStrip?: boolean }) {
  const settings = useSettings();
  const enabled = showMemoryStrip && (settings.lyricsMemoryOverlay ?? true);
  const currentTrackId = usePlayerStore((s) =>
    s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id : undefined,
  );
  const seek = usePlayerStore((s) => s.seek);
  const { active, photoUrl } = useScheduledMemory(enabled ? currentTrackId : undefined);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-3 pt-2"
      data-testid="lyrics-memory-strip"
    >
      <AnimatePresence mode="wait">
        {enabled && active && (
          <MemoryStripCard key={active.id} memory={active} onSeek={seek} photoUrl={photoUrl} />
        )}
      </AnimatePresence>
    </div>
  );
}
