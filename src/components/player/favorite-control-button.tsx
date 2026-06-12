import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { Button } from "@/components/ui/button";
import { HeartIcon } from "@/components/ui/heart";
import { db } from "@/db/muzero-db";
import { setTrackLiked } from "@/db/repositories";
import { useShortcutHint } from "@/hooks/use-shortcut-hint";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Like toggle for the chrome controls. It reads the current track id from the
 * player store, then subscribes to just that DB row's `liked` bit so liking a
 * track does not require churning the full playback queue snapshot.
 */
export function FavoriteControlButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const hint = useShortcutHint();
  const current = usePlayerStore(
    useShallow((s) => {
      const track = s.currentIndex >= 0 ? s.queue[s.currentIndex] : undefined;
      return track ? { id: track.id, liked: track.liked } : null;
    }),
  );
  const liked =
    useLiveQuery(
      async () => (current ? (await db.tracks.get(current.id))?.liked : undefined),
      [current?.id],
      current?.liked,
    ) ?? false;

  return (
    <ControlTooltip label={t("track.like")} keys={hint("like")}>
      <Button
        variant="ghost"
        size="icon"
        disabled={!current}
        onClick={() => current && void setTrackLiked(current.id, !liked)}
        aria-label={t("track.like")}
        aria-pressed={liked}
        className={cn(
          "rounded-full",
          liked ? "text-primary" : "text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        <HeartIcon size={18} className={cn(liked && "[&_svg]:fill-current")} />
      </Button>
    </ControlTooltip>
  );
}
