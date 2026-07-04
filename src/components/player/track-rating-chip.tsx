import { useLiveQuery } from "dexie-react-hooks";
import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { db } from "@/db/muzero-db";
import { setTrackRating } from "@/db/repositories";
import type { Track } from "@/db/types";
import { resolveTrackRating } from "@/lib/track-rating";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

const STARS = [1, 2, 3, 4, 5] as const;

/** Presentational 1–5 star selector. `value` = filled star count; clicking reports the 1-based star. */
export function RatingStars({
  value,
  onSelect,
  label,
}: {
  value: number;
  onSelect: (score: number) => void;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> injects legend/border chrome; a labelled group is intended
    <div aria-label={label} className="flex items-center" role="group">
      {STARS.map((star) => {
        const filled = star <= value;
        return (
          <button
            aria-label={t("rating.setStar", { defaultValue: "Rate {{score}} of 5", score: star })}
            className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-filled={filled}
            key={star}
            onClick={() => onSelect(star)}
            type="button"
          >
            <Star
              className={cn(
                "size-4",
                filled ? "fill-primary text-primary" : "text-muted-foreground/40",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Persistent crowd-rating chip for the currently-playing track (Now-Playing top).
 * Shows the average of all per-rater votes as filled stars + "avg · N votes"; the
 * host taps a star to cast/replace their own "self" vote. Nothing playing → hidden.
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
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 backdrop-blur-sm",
        className,
      )}
      data-testid="track-rating-chip"
    >
      <RatingStars
        label={t("rating.aria", { defaultValue: "Rate this song" })}
        onSelect={(score) => void setTrackRating(trackId, "self", score)}
        value={filled}
      />
      <span className="text-muted-foreground text-xs tabular-nums">
        {rating
          ? t("rating.summary", {
              average: rating.average.toFixed(1),
              count: rating.count,
              defaultValue: "{{average}} · {{count}}",
            })
          : t("rating.none", { defaultValue: "Not rated" })}
      </span>
    </div>
  );
}
