import { useLiveQuery } from "dexie-react-hooks";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { db } from "@/db/muzero-db";
import { listAllTracks, listTrackPlaybackStats } from "@/db/repositories";
import { useSession } from "@/hooks/use-app-data";
import {
  deriveHeartedPlaylist,
  deriveMostPlayedPlaylist,
  deriveRecentlyPlayedPlaylist,
  SYSTEM_PLAYLISTS,
  type SystemPlaylistId,
  type SystemPlaylistPlayable,
} from "@/lib/system-playlists";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

type CommonT = TFunction<"common", undefined>;

/**
 * The up-next queue (歌单列表) — a "playing from <set>" header + the virtualized
 * track list. Extracted from the now-playing rail so it can live in the unified
 * Dock drawer (all screen sizes) while the rail becomes lyrics-first.
 */
export function QueuePanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);
  const queueSource = usePlayerStore((s) => s.queueSource);
  const playSystemPlaylist = usePlayerStore((s) => s.playSystemPlaylist);
  const play = usePlayerStore((s) => s.play);
  const session = useSession(activeSessionId);
  const allTracks = useLiveQuery(() => listAllTracks(db), [], []);
  const playbackStats = useLiveQuery(() => listTrackPlaybackStats(db), [], []);
  const playbackEvents = useLiveQuery(() => db.playbackEvents.toArray(), [], []);
  const systemTracks = {
    "system:liked": deriveHeartedPlaylist(allTracks),
    "system:recent": localTracksFromPlayables(
      deriveRecentlyPlayedPlaylist(allTracks, { events: playbackEvents, stats: playbackStats }),
    ),
    "system:most": localTracksFromPlayables(
      deriveMostPlayedPlaylist(allTracks, {
        events: playbackEvents,
        now: Date.now(),
        range: "all",
        stats: playbackStats,
      }),
    ),
  } satisfies Record<SystemPlaylistId, typeof allTracks>;
  const sourceLabel =
    queueSource?.kind === "system-playlist"
      ? t("systemPlaylists.sourceLabel", { name: systemPlaylistLabel(queueSource.id, t) })
      : undefined;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {(session || sourceLabel) && (
        <div className="shrink-0 px-4 pb-2">
          <div className="text-muted-foreground text-xs">{t("nowPlaying.playingFrom")}</div>
          <div className="truncate font-semibold text-sm">{session?.name ?? sourceLabel}</div>
        </div>
      )}
      <div className="shrink-0 px-4 pb-3">
        <div className="mb-1.5 text-muted-foreground text-xs">
          {t("systemPlaylists.pinnedSources")}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {SYSTEM_PLAYLISTS.map((playlist) => (
            <button
              type="button"
              key={playlist.id}
              onClick={() => {
                void playSystemPlaylist(playlist.id, systemTracks[playlist.id]).then(play);
              }}
              className={cn(
                "min-w-0 rounded-md border border-border px-2 py-1.5 text-xs transition-colors hover:bg-accent",
                queueSource?.kind === "system-playlist" &&
                  queueSource.id === playlist.id &&
                  "border-primary/50 bg-accent text-primary",
              )}
            >
              <span className="block truncate">{systemPlaylistLabel(playlist.id, t)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 px-2">
        <VirtualTrackList tracks={queue} emptyHint={t("queue.empty")} className="no-scrollbar" />
      </div>
    </div>
  );
}

function localTracksFromPlayables(rows: SystemPlaylistPlayable[]) {
  return rows.flatMap((row) => (row.kind === "local-track" ? [row.track] : []));
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
