import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Presentational 1–5 star selector. `value` = filled star count; clicking reports the
 * 1-based star. Kept dependency-light (no store / DB imports) so any surface — the
 * Now-Playing chip, a track row, the batch bar — can render it without pulling the
 * player store's module side-effects into its test harness.
 */
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
