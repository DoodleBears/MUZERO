import { Disc3, Pause, Play } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { trackSubtitle } from "@/lib/track-display";
import { transitionState } from "@/lib/view-transition-react";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";

/** Tailwind `md` breakpoint — desktop opens the Now Playing tab, mobile the sheet. */
const DESKTOP_QUERY = "(min-width: 48rem)";

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
  const openSheet = useUiStore((s) => s.openSheet);

  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const coverUrl = useTrackCoverUrl(current);

  // Mobile expands the full-screen sheet; desktop navigates to the Now Playing tab.
  function handleOpen() {
    if (!current) return;
    const desktop = typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches;
    if (desktop) onOpen && transitionState(onOpen);
    else openSheet();
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleOpen}
        disabled={!current}
        aria-label={t("nav.now")}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <motion.span
          layoutId="now-cover"
          className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-secondary"
        >
          {coverUrl ? (
            <img src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <Disc3 className="size-5 text-muted-foreground" />
          )}
        </motion.span>
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
