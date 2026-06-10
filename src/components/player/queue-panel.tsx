import { useTranslation } from "react-i18next";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { useSession } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

/**
 * The up-next queue (歌单列表) — a "playing from <set>" header + the virtualized
 * track list. Extracted from the now-playing rail so it can live in the unified
 * Dock drawer (all screen sizes) while the rail becomes lyrics-first.
 */
export function QueuePanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);
  const session = useSession(activeSessionId);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {session && (
        <div className="shrink-0 px-4 pb-2">
          <div className="text-muted-foreground text-xs">{t("nowPlaying.playingFrom")}</div>
          <div className="truncate font-semibold text-sm">{session.name}</div>
        </div>
      )}
      <div className="min-h-0 flex-1 px-2">
        <VirtualTrackList tracks={queue} emptyHint={t("queue.empty")} className="no-scrollbar" />
      </div>
    </div>
  );
}
