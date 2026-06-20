import type { TFunction } from "i18next";
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
import { updateSession } from "@/db/repositories";
import type { DjSession, PlaylistAutoSyncFrequency, StreamSourceId } from "@/db/types";
import { notify } from "@/stores/notification-store";
import { subscribeToPlaylist } from "@/stores/playlist-auto-sync";

const FREQUENCIES: PlaylistAutoSyncFrequency[] = ["manual", "app-start", "15min", "30min", "60min"];

export function freqLabel(t: TFunction, freq: PlaylistAutoSyncFrequency): string {
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

/**
 * Per-playlist auto-sync controls (frequency dropdown + "auto-download new videos" toggle),
 * bound to ONE external playlist/favlist. Shared by the source-playlists list (Settings) and
 * the subscribed-playlists panel — both write to the bound set via {@link subscribeToPlaylist}
 * (find-or-create + cadence + immediate sync), so the set is the single source of truth.
 */
export function PlaylistSyncControls({
  source,
  playlistId,
  name,
  coverUrl,
  matched,
}: {
  source: StreamSourceId;
  playlistId: string;
  name: string;
  coverUrl?: string;
  /** The set already bound to this playlist, if any (carries current cadence/flags). */
  matched: DjSession | undefined;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const frequency = matched?.autoSyncFrequency ?? "manual";
  const autoDownload = matched?.autoDownloadNew === true;

  async function apply(next: { frequency: PlaylistAutoSyncFrequency; autoDownloadNew: boolean }) {
    setBusy(true);
    try {
      // "manual" with no bound set yet → nothing to subscribe; just record on an existing set.
      if (next.frequency === "manual") {
        if (matched)
          await updateSession(matched.id, {
            autoSyncFrequency: "manual",
            autoDownloadNew: next.autoDownloadNew,
          });
      } else {
        await subscribeToPlaylist(source, playlistId, name, { ...next, coverUrl });
        notify.success(t("playlistSync.subscribed", { name }));
      }
    } catch {
      notify.error(t("playlistSync.syncFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={frequency}
        disabled={busy}
        onValueChange={(value) => {
          if (value)
            void apply({
              frequency: value as PlaylistAutoSyncFrequency,
              autoDownloadNew: autoDownload,
            });
        }}
      >
        <SelectTrigger className="h-7 w-auto min-w-24 px-2 text-foreground text-xs">
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
      {frequency !== "manual" && (
        <label
          htmlFor={`auto-dl-${source}-${playlistId}`}
          className="flex cursor-pointer items-center gap-1.5 text-muted-foreground text-xs"
        >
          <Checkbox
            id={`auto-dl-${source}-${playlistId}`}
            checked={autoDownload}
            disabled={busy}
            onCheckedChange={(checked) =>
              void apply({ frequency, autoDownloadNew: checked === true })
            }
          />
          <span>{t("playlistSync.autoDownload")}</span>
        </label>
      )}
    </div>
  );
}
