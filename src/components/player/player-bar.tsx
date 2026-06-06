import { Pause, Play, Repeat, Repeat1, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatDuration } from "@/lib/utils";
import type { RepeatMode } from "@/player/queue";
import { usePlayerStore } from "@/stores/player-store";

const REPEAT_CYCLE: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };

/** Persistent bottom transport bar. */
export function PlayerBar() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const volume = usePlayerStore((s) => s.volume);
  const repeat = usePlayerStore((s) => s.repeat);

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setRepeat = usePlayerStore((s) => s.setRepeat);

  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;

  return (
    <div className="border-t border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{current?.title ?? "MUZERO"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {current?.brief.caption ?? "Press play — the AI DJ takes it from here"}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void prev()} aria-label="Previous">
            <SkipBack />
          </Button>
          <Button size="icon-lg" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <Pause /> : <Play />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void next()} aria-label="Next">
            <SkipForward />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setRepeat(REPEAT_CYCLE[repeat])}
            aria-label={`Repeat: ${repeat}`}
            className={repeat !== "off" ? "text-primary" : undefined}
          >
            {repeat === "one" ? <Repeat1 /> : <Repeat />}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
            {formatDuration(positionSec)}
          </span>
          <Slider
            value={durationSec > 0 ? (positionSec / durationSec) * 100 : 0}
            onValueChange={(pct) => seek((pct / 100) * durationSec)}
            className="flex-1"
          />
          <span className="w-10 text-[11px] tabular-nums text-muted-foreground">
            {formatDuration(durationSec)}
          </span>
          <Volume2 className="ml-2 size-4 shrink-0 text-muted-foreground" />
          <Slider
            value={volume * 100}
            onValueChange={(v) => setVolume(v / 100)}
            className="hidden w-20 sm:block"
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
}
