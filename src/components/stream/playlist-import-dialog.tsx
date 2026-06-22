import { ArrowDownToLine, Download, ListPlus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Disc3Icon } from "@/components/ui/disc-3";
import { useSessions, useSettings } from "@/hooks/use-app-data";
import { notify } from "@/stores/notification-store";
import { usePlayerStore } from "@/stores/player-store";
import {
  canDownloadVideo,
  downloadPlaylistVideos,
  downloadPlaylistVideosToSet,
} from "@/streamsrc/download-action";
import type { StreamPlaylist } from "@/streamsrc/provider";

/**
 * Decide where a playlist's tracks land before importing. If a set was previously
 * synced from this same external playlist (matched by `streamPlaylistRef`), the
 * modal recommends an incremental re-sync into it; otherwise the user can add the
 * tracks to any existing set (auto-deduped) or create a fresh one.
 *
 * Controlled: pass the `playlist` to open, `null` to close. Shared by the Settings
 * "我的歌单" list and the ⌘F pasted-link card.
 */
export function PlaylistImportDialog({
  playlist,
  onClose,
}: {
  playlist: StreamPlaylist | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sessions = useSessions();
  const settings = useSettings();
  const importStreamedPlaylist = usePlayerStore((s) => s.importStreamedPlaylist);
  const addStreamedPlaylistToSet = usePlayerStore((s) => s.addStreamedPlaylistToSet);
  const [busy, setBusy] = useState(false);
  // null while fetching the hit list (indeterminate); {done,total} once tracks write.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [targetId, setTargetId] = useState("");
  // When on, every import path below also downloads the tracks to local blobs
  // (offline play + stable cover-color extraction) in the background after import.
  const [download, setDownload] = useState(false);

  // Reset the chosen target whenever the dialog opens for a different playlist.
  const key = playlist ? `${playlist.source}:${playlist.id}` : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the playlist identity
  useEffect(() => {
    setTargetId("");
  }, [key]);

  if (!playlist) return null;
  const pl = playlist;
  const matched = sessions.find(
    (s) => s.streamPlaylistRef?.source === pl.source && s.streamPlaylistRef?.id === pl.id,
  );

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setProgress(null);
    try {
      await action();
      onClose();
    } catch {
      notify.error(t("streamSources.importError"));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const onProgress = (done: number, total: number) => setProgress({ done, total });

  // Default for video sources: import the favlist AND download each item as a local video
  // (Settings → "auto-download playlist videos", on by default). Audio sources / setting-off
  // keep the streaming-reference import (with the optional "download to device" checkbox).
  const defaultDownloadsVideo =
    canDownloadVideo(pl.source) && settings.autoDownloadPlaylistVideos !== false;

  const createNewSet = () =>
    run(async () => {
      if (defaultDownloadsVideo) {
        const { queued } = await downloadPlaylistVideos(pl.source, pl.id, {
          name: pl.name,
          coverUrl: pl.coverUrl,
        });
        notify.success(t("download.queuedVideos", { count: queued }));
        return;
      }
      const count = await importStreamedPlaylist(pl.source, pl.id, pl.name, {
        coverUrl: pl.coverUrl,
        download,
        onProgress,
      });
      notify.success(t("streamSources.imported", { count, name: pl.name }));
    });

  const syncInto = (setId: string, setName: string) =>
    run(async () => {
      // Video source (default-download-video on): re-sync through the persistent download
      // queue so NEW MVs download in place AND the unified indicator shows their progress —
      // the old `addStreamedPlaylistToSet` cached audio to memory blobs with no progress.
      if (defaultDownloadsVideo) {
        const { added, skipped } = await downloadPlaylistVideosToSet(pl.source, pl.id, setId, {
          onProgress,
        });
        notify.success(t("playlistImport.added", { added, skipped, name: setName }));
        return;
      }
      const { added, skipped } = await addStreamedPlaylistToSet(pl.source, pl.id, setId, {
        download,
        onProgress,
      });
      notify.success(t("playlistImport.added", { added, skipped, name: setName }));
    });

  const downloadAsVideo = () =>
    run(async () => {
      const { queued } = await downloadPlaylistVideos(pl.source, pl.id, {
        name: pl.name,
        coverUrl: pl.coverUrl,
      });
      notify.success(t("download.queuedVideos", { count: queued }));
    });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      {/* z-[100] so it sits above the ⌘F search overlay (z-90), which is its own backdrop. */}
      <DialogContent className="z-[100] gap-3">
        <DialogTitle>{t("playlistImport.title")}</DialogTitle>
        <div className="flex items-center gap-3">
          <div className="grid size-12 shrink-0 place-items-center overflow-hidden bg-secondary text-muted-foreground album-cover-radius album-cover-shadow">
            {pl.coverUrl ? (
              <img
                src={pl.coverUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="size-full object-cover"
              />
            ) : (
              <Disc3Icon size={18} />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-sm">{pl.name}</div>
            <DialogDescription>
              {t("streamSources.trackCount", { count: pl.trackCount })} · {pl.source}
            </DialogDescription>
          </div>
        </div>

        {matched && (
          <button
            type="button"
            disabled={busy}
            onClick={() => syncInto(matched.id, matched.name)}
            className="flex w-full items-center gap-2 rounded-lg border border-primary bg-accent px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/70 disabled:opacity-60"
          >
            <RefreshCw className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {t("playlistImport.syncRecommended", { name: matched.name })}
            </span>
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
              {t("playlistImport.recommendedTag")}
            </span>
          </button>
        )}

        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs">{t("playlistImport.orAddToExisting")}</p>
          <div className="flex gap-2">
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={busy}
              className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-foreground text-sm"
            >
              <option value="">{t("playlistImport.choosePlaceholder")}</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !targetId}
              onClick={() => {
                const s = sessions.find((x) => x.id === targetId);
                if (s) syncInto(s.id, s.name);
              }}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50"
            >
              {t("playlistImport.addButton")}
            </button>
          </div>
        </div>

        {defaultDownloadsVideo ? (
          // Video source + default-download-video: the primary action already downloads each
          // item as video — show a hint instead of the audio-cache checkbox.
          <p className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-muted-foreground text-xs">
            <ArrowDownToLine className="size-3.5 shrink-0" />
            {t("playlistImport.willDownloadVideo")}
          </p>
        ) : (
          <label
            htmlFor="playlist-import-download"
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-accent/50"
          >
            <Checkbox
              id="playlist-import-download"
              checked={download}
              onCheckedChange={(checked) => setDownload(checked === true)}
              disabled={busy}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium text-sm">
                <ArrowDownToLine className="size-3.5 shrink-0" />
                {t("playlistImport.download")}
              </span>
              <span className="block text-muted-foreground text-xs">
                {t("playlistImport.downloadHint")}
              </span>
            </span>
          </label>
        )}

        {busy && (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className={
                  progress
                    ? "h-full bg-primary transition-[width] duration-200"
                    : "h-full w-1/3 animate-pulse bg-primary"
                }
                style={
                  progress
                    ? {
                        width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                      }
                    : undefined
                }
              />
            </div>
            {progress && (
              <p className="text-right text-muted-foreground text-xs tabular-nums">
                {progress.done} / {progress.total}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => onClose()}
            className="rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground disabled:opacity-50"
          >
            {t("playlistImport.cancel")}
          </button>
          <div className="flex items-center gap-2">
            {/* Setting OFF: offer an explicit one-time "download as video" alongside refs-import.
                Setting ON (defaultDownloadsVideo): the primary button already downloads. */}
            {canDownloadVideo(pl.source) && !defaultDownloadsVideo && (
              <button
                type="button"
                disabled={busy}
                onClick={downloadAsVideo}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-60"
              >
                <Download className="size-4" />
                {t("download.allVideos")}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={createNewSet}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {defaultDownloadsVideo ? (
                <Download className="size-4" />
              ) : (
                <ListPlus className="size-4" />
              )}
              {busy
                ? t("streamSources.importing")
                : defaultDownloadsVideo
                  ? t("playlistImport.newSetWithVideo")
                  : t("playlistImport.newSet")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
