import { Heart, HeartMinus, HeartPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { setTracksLiked } from "@/db/repositories";
import { notify } from "@/stores/notification-store";

/**
 * Batch like/unlike — a Popover offering both directions (the heart isn't a toggle
 * because a mixed selection has no single state to flip). Both write in ONE bulk
 * transaction via {@link setTracksLiked} (bulkPut / bulkDelete on the `trackLikes`
 * side table — no per-track loop, no `tracks`-table fan-out). Keeps the selection
 * intact so likes can be chained with rating / add-to-set before leaving select mode.
 */
export function BatchLikeMenu({ trackIds }: { trackIds: string[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const disabled = trackIds.length === 0;
  const heartLabel = t("select.like");
  const itemClass =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground text-xs transition-colors hover:bg-accent";

  async function set(liked: boolean) {
    if (trackIds.length === 0) return;
    setOpen(false);
    await setTracksLiked(trackIds, liked);
    notify.success(
      liked
        ? t("select.liked", { count: trackIds.length })
        : t("select.unliked", { count: trackIds.length }),
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            disabled={disabled}
            aria-label={heartLabel}
            title={heartLabel}
          >
            <Heart className="size-4" />
          </Button>
        }
      />
      <PopoverContent className="w-40 p-1" side="top" sideOffset={10}>
        <PopoverTitle className="sr-only">{heartLabel}</PopoverTitle>
        <PopoverDescription className="sr-only">{heartLabel}</PopoverDescription>
        <button type="button" className={itemClass} onClick={() => void set(true)}>
          <HeartPlus className="size-4" />
          {t("select.like")}
        </button>
        <button type="button" className={itemClass} onClick={() => void set(false)}>
          <HeartMinus className="size-4" />
          {t("select.unlike")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
