import { useLiveQuery } from "dexie-react-hooks";
import type { TFunction } from "i18next";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db } from "@/db/muzero-db";
import { updateSession } from "@/db/repositories";
import type { DjSession, PlaylistAutoSyncFrequency } from "@/db/types";
import { cn } from "@/lib/utils";
import { notify } from "@/stores/notification-store";
import { syncBoundPlaylistSet } from "@/stores/playlist-auto-sync";

const FREQUENCIES: PlaylistAutoSyncFrequency[] = ["manual", "app-start", "15min", "30min", "60min"];

/**
 * Sets bound to an external playlist/favlist (`streamPlaylistRef`) + their auto-sync cadence.
 * Per the PRD: frequency dropdown (manual / app-start / 15·30·60min) + "auto-download new" toggle
 * + a manual "sync now". Everything off / manual by default (online-source red line).
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

function freqLabel(t: TFunction, freq: PlaylistAutoSyncFrequency) {
  switch (freq) {
    case "manual":
      return t("playlistSync.freqManual");
    case "app-start":
      return t("playlistSync.freqAppStart");
    case "15min":
      return t("playlistSync.freq15");
    case "30min":
      return t("playlistSync.freq30");
    case "60min":
      return t("playlistSync.freq60");
  }
}

function PlaylistSyncRow({ set }: { set: DjSession }) {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const frequency = set.autoSyncFrequency ?? "manual";

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
    <div className="space-y-2 rounded-md px-2 py-2 transition-colors hover:bg-accent/40">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{set.name}</span>
        <Select
          value={frequency}
          onValueChange={(value) => {
            if (value)
              void updateSession(set.id, {
                autoSyncFrequency: value as PlaylistAutoSyncFrequency,
              });
          }}
        >
          <SelectTrigger className="h-8 w-auto min-w-24 px-2 text-foreground text-xs">
            <SelectValue>
              {(value) => freqLabel(t, (value as PlaylistAutoSyncFrequency) ?? "manual")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map((f) => (
              <SelectItem key={f} value={f}>
                {freqLabel(t, f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      {frequency !== "manual" && (
        <label
          htmlFor={`auto-dl-${set.id}`}
          className="flex cursor-pointer items-center gap-2 text-muted-foreground text-xs"
        >
          <Checkbox
            id={`auto-dl-${set.id}`}
            checked={set.autoDownloadNew === true}
            onCheckedChange={(checked) =>
              void updateSession(set.id, { autoDownloadNew: checked === true })
            }
          />
          <span>{t("playlistSync.autoDownload")}</span>
        </label>
      )}
    </div>
  );
}
