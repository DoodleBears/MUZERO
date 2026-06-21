import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateSession } from "@/db/repositories";
import type { DjSession, PlaylistAutoSyncFrequency, StreamSourceId } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { notify } from "@/stores/notification-store";
import { subscribeToPlaylist } from "@/stores/playlist-auto-sync";
import { canDownloadVideo } from "@/streamsrc/download-action";

const FREQUENCIES: PlaylistAutoSyncFrequency[] = ["manual", "app-start", "15min", "30min", "60min"];

/** What an auto-sync downloads for newly-added items. Default "video" ("默认应该是视频"). */
type DownloadMode = "video" | "audio" | "off";
const DOWNLOAD_MODES: DownloadMode[] = ["video", "audio", "off"];

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

function modeLabel(t: TFunction, mode: DownloadMode): string {
  switch (mode) {
    case "video":
      return t("playlistSync.dlVideo");
    case "audio":
      return t("playlistSync.dlAudio");
    case "off":
      return t("playlistSync.dlOff");
  }
}

/**
 * Per-playlist auto-sync controls: a cadence dropdown + a "download new items as" mode dropdown
 * (video / audio / don't download — default video), bound to ONE external playlist/favlist. Shared
 * by the source-playlists list (Settings) and the subscribed-playlists panel — both write to the
 * bound set via {@link subscribeToPlaylist} (find-or-create + cadence + immediate sync), so the set
 * is the single source of truth.
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
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const frequency = matched?.autoSyncFrequency ?? "manual";
  // An already-bound set keeps its recorded choice; a new subscription defaults to "video"
  // when the global "auto-download playlist videos" setting is on, else "off".
  const downloadMode: DownloadMode = matched
    ? matched.autoDownloadNew
      ? matched.autoDownloadAudioOnly
        ? "audio"
        : "video"
      : "off"
    : settings.autoDownloadPlaylistVideos !== false
      ? "video"
      : "off";

  async function apply(next: { frequency: PlaylistAutoSyncFrequency; downloadMode: DownloadMode }) {
    const autoDownloadNew = next.downloadMode !== "off";
    const audioOnly = next.downloadMode === "audio";
    setBusy(true);
    try {
      // "manual" with no bound set yet → nothing to subscribe; just record on an existing set.
      if (next.frequency === "manual") {
        if (matched)
          await updateSession(matched.id, {
            autoSyncFrequency: "manual",
            autoDownloadNew,
            autoDownloadAudioOnly: audioOnly,
          });
      } else {
        await subscribeToPlaylist(source, playlistId, name, {
          frequency: next.frequency,
          autoDownloadNew,
          audioOnly,
          coverUrl,
        });
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
          if (value) void apply({ frequency: value as PlaylistAutoSyncFrequency, downloadMode });
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
      {frequency !== "manual" && canDownloadVideo(source) && (
        <Select
          value={downloadMode}
          disabled={busy}
          onValueChange={(value) => {
            if (value) void apply({ frequency, downloadMode: value as DownloadMode });
          }}
        >
          <SelectTrigger className="h-7 w-auto min-w-24 px-2 text-foreground text-xs">
            <SelectValue>{(value) => modeLabel(t, (value as DownloadMode) ?? "video")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DOWNLOAD_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {modeLabel(t, m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
