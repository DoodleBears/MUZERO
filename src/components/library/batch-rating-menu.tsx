import { Star, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RatingStars } from "@/components/player/rating-stars";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { clearTracksRating, setTracksRating } from "@/db/repositories";
import { notify } from "@/stores/notification-store";

/**
 * Batch star rating — a Popover with the shared 1–5 selector (plus a clear button)
 * that writes the host's "self" vote across ALL `trackIds` at once. Rendered as a
 * compact icon action in the select-mode batch bar, mirroring {@link AddToSetMenu}.
 */
export function BatchRatingMenu({ trackIds }: { trackIds: string[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const disabled = trackIds.length === 0;
  const rateLabel = t("select.rate", { defaultValue: "Rate" });

  async function apply(score: number) {
    if (trackIds.length === 0) return;
    setOpen(false);
    await setTracksRating(trackIds, "self", score);
    notify.success(t("select.rated", { count: trackIds.length, score }));
  }

  async function clear() {
    if (trackIds.length === 0) return;
    setOpen(false);
    await clearTracksRating(trackIds, "self");
    notify.success(t("select.ratingCleared", { count: trackIds.length }));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            disabled={disabled}
            aria-label={rateLabel}
            title={rateLabel}
          >
            <Star className="size-4" />
          </Button>
        }
      />
      <PopoverContent className="w-auto p-2" side="top" sideOffset={10}>
        <PopoverTitle className="px-1 pb-1.5 text-muted-foreground text-xs">
          {rateLabel}
        </PopoverTitle>
        <PopoverDescription className="sr-only">{rateLabel}</PopoverDescription>
        <div className="flex items-center gap-1.5">
          <RatingStars value={0} onSelect={(score) => void apply(score)} label={rateLabel} />
          <button
            type="button"
            aria-label={t("rating.clear", { defaultValue: "Clear my rating" })}
            title={t("rating.clear", { defaultValue: "Clear my rating" })}
            onClick={() => void clear()}
            className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
