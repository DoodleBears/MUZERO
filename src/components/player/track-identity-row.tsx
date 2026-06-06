import { Disc3, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { trackSubtitle } from "@/lib/track-display";
import { transitionState } from "@/lib/view-transition-react";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Row 1 of the player-dock: cover + title/artist + the single play/pause button
 * (collapsed transport stays minimal, Poweramp-style). Tapping the cover/text
 * opens Now Playing (desktop → "now" tab; mobile → full sheet, wired in Phase 4)
 * via `onOpen`. Subscribes to track + play state only — not the per-tick position.
 */
export function TrackIdentityRow({ onOpen }: { onOpen?: () => void }) {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const coverUrl = useTrackCoverUrl(current);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onOpen && transitionState(onOpen)}
        disabled={!current}
        aria-label={t("nav.now")}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-secondary">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <Disc3 className="size-5 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{current?.title ?? "MUZERO"}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {current ? trackSubtitle(current) : t("app.pressPlay")}
          </span>
        </span>
      </button>
      <Button
        size="icon-lg"
        onClick={togglePlay}
        aria-label={isPlaying ? t("player.pause") : t("player.play")}
        className="shrink-0 rounded-full"
      >
        {isPlaying ? <Pause /> : <Play />}
      </Button>
    </div>
  );
}
