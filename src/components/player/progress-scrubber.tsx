import { Slider } from "@/components/ui/slider";
import { formatDuration } from "@/lib/utils";
import { progressPercent } from "@/player/transport";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Row 2 of the player-dock: the full-width seek bar + elapsed/total time. Kept as
 * its own leaf subscribing only to position/duration so the ~per-tick
 * `positionSec` updates never re-render the identity row or the nav (hard rule #6).
 */
export function ProgressScrubber() {
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const seek = usePlayerStore((s) => s.seek);

  return (
    <div className="flex items-center gap-2">
      <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
        {formatDuration(positionSec)}
      </span>
      <Slider
        value={progressPercent(positionSec, durationSec)}
        onValueChange={(pct) => seek((pct / 100) * durationSec)}
        className="flex-1"
      />
      <span className="w-9 shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {formatDuration(durationSec)}
      </span>
    </div>
  );
}
