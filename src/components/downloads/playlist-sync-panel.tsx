import { useLiveQuery } from "dexie-react-hooks";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PlaylistSyncControls } from "@/components/downloads/playlist-sync-controls";
import { db } from "@/db/muzero-db";
import type { DjSession } from "@/db/types";
import { cn } from "@/lib/utils";
import { notify } from "@/stores/notification-store";
import { syncBoundPlaylistSet } from "@/stores/playlist-auto-sync";

/**
 * Sets bound to an external playlist/favlist (`streamPlaylistRef`) + their auto-sync cadence —
 * an at-a-glance "subscribed" list (covers sets whose source isn't expanded above). The same
 * per-playlist {@link PlaylistSyncControls} the source-playlists rows use, plus a manual sync-now.
 */
export function PlaylistSyncPanel() {
  const { t } = useTranslation();
  const sets = useLiveQuery(
    () =>
      db.sessions
        .filter((s) => s.streamPlaylistRef != null)
        .toArray()
        .then((rows) => rows.sort((a, b) => b.updatedAt - a.updatedAt)),
    [],
    [] as DjSession[],
  );

  if (sets.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <span className="font-medium text-sm">{t("playlistSync.title")}</span>
      <div className="space-y-1">
        {sets.map((set) => (
          <PlaylistSyncRow key={set.id} set={set} />
        ))}
      </div>
    </div>
  );
}

function PlaylistSyncRow({ set }: { set: DjSession }) {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const ref = set.streamPlaylistRef;

  async function syncNow() {
    setSyncing(true);
    try {
      await syncBoundPlaylistSet(set.id);
      notify.success(t("playlistSync.synced"));
    } catch {
      notify.error(t("playlistSync.syncFailed"));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-accent/40">
      <span className="min-w-0 flex-1 truncate font-medium text-sm">{set.name}</span>
      {ref && (
        <PlaylistSyncControls
          source={ref.source}
          playlistId={ref.id}
          name={set.name}
          matched={set}
        />
      )}
      <button
        type="button"
        onClick={() => void syncNow()}
        disabled={syncing}
        aria-label={t("playlistSync.syncNow")}
        title={t("playlistSync.syncNow")}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
      </button>
    </div>
  );
}
