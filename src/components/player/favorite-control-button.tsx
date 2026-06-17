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
  const currentId = usePlayerStore(
    useShallow((s) => (s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id : undefined)),
  );
  // Subscribe to just this track's `trackLikes` row — liking re-fires only this
  // single-key query, never the play-queue snapshot (PRD 20260617-scalable-track-list).
  const liked =
    useLiveQuery(
      async () => (currentId ? (await db.trackLikes.get(currentId)) != null : false),
      [currentId],
      false,
    ) ?? false;

  return (
    <ControlTooltip label={t("track.like")} keys={hint("like")}>
      <Button
        variant="ghost"
        size="icon"
        disabled={!currentId}
        onClick={() => currentId && void setTrackLiked(currentId, !liked)}
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
