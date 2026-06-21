import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { useSession } from "@/hooks/use-app-data";
import type { SystemPlaylistId } from "@/lib/system-playlists";
import { cn } from "@/lib/utils";
import type { QueueSource } from "@/stores/player-store";
import { usePlayerStore } from "@/stores/player-store";

type CommonT = TFunction<"common", undefined>;

/**
 * The up-next play queue (播放列表) — a "playing from <source>" header + the
 * virtualized track list of the *current playback queue*. This is deliberately
 * NOT a 歌单 picker: the pinned system-playlist sources live in the library
 * (search page) via `SystemPlaylistCards`; the Dock drawer only mirrors what's
 * actually queued to play so it stays a pure "up next" surface.
 */
export function QueuePanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);
  const queueSource = usePlayerStore((s) => s.queueSource);
  const session = useSession(activeSessionId);
  const sourceLabel = resolveQueueSourceLabel(queueSource, t);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {(session || sourceLabel) && (
        <div className="shrink-0 px-4 pb-3">
          <div className="text-muted-foreground text-xs">{t("nowPlaying.playingFrom")}</div>
          <div className="truncate font-semibold text-sm">{session?.name ?? sourceLabel}</div>
        </div>
      )}
      <div className="min-h-0 flex-1 px-2">
        <VirtualTrackList
          tracks={queue}
          reactiveRowContent
          emptyHint={t("queue.empty")}
          className="no-scrollbar"
        />
      </div>
    </div>
  );
}

/** "Playing from" label for a non-set queue source (set context uses the set name). */
function resolveQueueSourceLabel(source: QueueSource | undefined, t: CommonT): string | undefined {
  switch (source?.kind) {
    case "system-playlist":
      return t("systemPlaylists.sourceLabel", { name: systemPlaylistLabel(source.id, t) });
    case "entity":
      return source.label;
    case "online-playlist":
      return source.playlist.name;
    case "library":
      return t("globalSearch.songs");
    default:
      return undefined; // set context: the header shows the set name instead
  }
}

function systemPlaylistLabel(id: SystemPlaylistId, t: CommonT) {
  switch (id) {
    case "system:liked":
      return t("systemPlaylists.hearted");
    case "system:recent":
      return t("systemPlaylists.recentlyPlayed");
    default:
      return t("systemPlaylists.mostPlayed");
  }
}
