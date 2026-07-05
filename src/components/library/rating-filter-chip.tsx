import { Star, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { chipActiveClass, chipClass, chipIdleClass } from "@/components/library/sort-chip";
import { RatingStars } from "@/components/player/rating-stars";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { RatingRange } from "@/lib/track-gallery";
import { formatRatingValue } from "@/lib/track-rating";
import { cn } from "@/lib/utils";

/**
 * Rating-range filter pill for the 全部歌曲 toolbar: sits next to the 红心
 * FilterChip and opens a popover with a min + max star picker (inclusive 1–5
 * window over the crowd-rating average). Picking min > max drags max along (and
 * vice versa) so the range is always valid; the × inside the popover clears the
 * filter. The pill label echoes the active window ("3–5", or a single "4").
 */
export function RatingFilterChip({
  value,
  onChange,
}: {
  value: RatingRange | null;
  onChange: (range: RatingRange | null) => void;
}) {
  const { t } = useTranslation();
  const active = value !== null;
  const rangeLabel = value
    ? value.min === value.max
      ? formatRatingValue(value.min)
      : `${formatRatingValue(value.min)}–${formatRatingValue(value.max)}`
    : null;
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-pressed={active}
        className={cn(chipClass, active ? chipActiveClass : chipIdleClass)}
      >
        <Star className={cn("size-3.5", active && "fill-current")} />
        {t("gallery.filterRating")}
        {rangeLabel && <span className="tabular-nums">{rangeLabel}</span>}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" sideOffset={8}>
        <PopoverTitle className="sr-only">{t("gallery.filterRating")}</PopoverTitle>
        <PopoverDescription className="sr-only">{t("gallery.filterRatingHint")}</PopoverDescription>
        <div className="flex flex-col gap-2">
          <RatingBoundRow
            label={t("gallery.ratingMin")}
            value={value?.min ?? 0}
            onSelect={(score) => onChange({ min: score, max: Math.max(score, value?.max ?? 5) })}
          />
          <RatingBoundRow
            label={t("gallery.ratingMax")}
            value={value?.max ?? 0}
            onSelect={(score) => onChange({ min: Math.min(score, value?.min ?? 1), max: score })}
          />
          {active && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-1 self-start rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3" />
              {t("gallery.ratingClear")}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One labelled bound (min or max) of the range: label + a 1–5 star picker. */
function RatingBoundRow({
  label,
  value,
  onSelect,
}: {
  label: string;
  value: number;
  onSelect: (score: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <RatingStars label={label} value={value} onSelect={onSelect} />
    </div>
  );
}
