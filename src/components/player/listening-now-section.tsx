import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRemotePresence } from "@/hooks/use-remote-presence";
import { usePlayerStore } from "@/stores/player-store";
import { ListeningNowList } from "./listening-now-list";

/**
 * "Listening now" surface for a remote/shared set (PRD §5.5). Polls presence for
 * the active set's source drive only while this section is mounted (visible), and
 * renders nothing for local sets or when no device is currently active.
 */
export function ListeningNowSection() {
  const { t } = useTranslation();
  const activeSessionId = usePlayerStore((state) => state.activeSessionId);
  const queue = usePlayerStore((state) => state.queue);
  const presenceRows = useRemotePresence(activeSessionId);

  const trackTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const track of queue) map.set(track.id, track.title);
    return map;
  }, [queue]);

  if (presenceRows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {t("nowPlaying.listeningNow")}
      </h3>
      <ListeningNowList
        ariaLabel={t("nowPlaying.listeningNow")}
        presenceRows={presenceRows}
        trackTitleById={trackTitleById}
      />
    </section>
  );
}
