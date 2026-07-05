import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RatingStars } from "@/components/player/rating-stars";
import { db } from "@/db/muzero-db";
import { clearTrackRating, setTrackRating } from "@/db/repositories";
import type { Track } from "@/db/types";
import { resolveTrackRating } from "@/lib/track-rating";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

// Re-exported for existing importers; the component itself lives in the
// dependency-light `rating-stars` module (no store/DB imports).
export { RatingStars };

/**
 * Persistent crowd-rating chip for the currently-playing track (Now-Playing top).
 * Shows the average of all per-rater votes as filled stars; the "avg · N votes"
 * summary (plus a clear-my-vote button when the host has voted) stays collapsed and
 * slides open on hover (only when votes exist). The host taps a star to cast/replace
 * their own "self" vote. Nothing playing → hidden.
 * Audience votes arrive via the `评分` intake command (see live-request-annotation).
 */
export function TrackRatingChip({ className }: { className?: string }) {
  const { t } = useTranslation();
  const trackId = usePlayerStore((s) =>
    s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id : undefined,
  );
  const track = useLiveQuery<Track | undefined>(
    () => (trackId ? db.tracks.get(trackId) : Promise.resolve(undefined)),
    [trackId],
  );
  if (!trackId) return null;
  const rating = track ? resolveTrackRating(track) : null;
  const filled = rating ? Math.round(rating.average) : 0;
  const hasSelfVote = track?.ratingsByRater?.self !== undefined;
  return (
    <div
      className={cn(
        "group inline-flex items-center rounded-full border border-border/60 bg-background/60 px-2.5 py-1 backdrop-blur-sm",
        className,
      )}
      data-testid="track-rating-chip"
    >
      <RatingStars
        label={t("rating.aria", { defaultValue: "Rate this song" })}
        onSelect={(score) => void setTrackRating(trackId, "self", score)}
        value={filled}
      />
      {rating && (
        // max-width (not the 0fr→1fr grid trick) because the chip is an
        // intrinsically-sized flex container, where a 1fr column resolves to 0
        // and never expands; max-w-48 comfortably fits the longest locale string.
        <span className="flex max-w-0 items-center overflow-hidden opacity-0 transition-all duration-300 group-hover:ml-2 group-hover:max-w-48 group-hover:opacity-100">
          <span className="whitespace-nowrap text-muted-foreground text-xs tabular-nums">
            {t("rating.summary", {
              average: rating.average.toFixed(1),
              count: rating.count,
              defaultValue: "{{average}} · {{count}}",
            })}
          </span>
          {hasSelfVote && (
            <button
              aria-label={t("rating.clear", { defaultValue: "Clear my rating" })}
              className="ml-1 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void clearTrackRating(trackId, "self")}
              title={t("rating.clear", { defaultValue: "Clear my rating" })}
              type="button"
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}
