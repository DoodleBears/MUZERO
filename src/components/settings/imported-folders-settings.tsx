import { FolderPlus, FolderX, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { removeImportFolder, resetImportedFolders, updateImportFolder } from "@/db/repositories";
import { useSessions, useSettings } from "@/hooks/use-app-data";
import { hasFolderAccess } from "@/lib/desktop/bridge";
import { notify } from "@/stores/notification-store";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Settings card for remembered local-import folders. Desktop only — in the
 * browser there's no persistent absolute-path access, so it just notes that.
 * Each folder shows its bound set + last-sync; "Sync now" re-scans, "Stop
 * watching" forgets the folder (imported tracks are kept).
 */
export function ImportedFoldersSettings() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const sessions = useSessions();
  const isUploading = usePlayerStore((s) => s.isUploading);
  const importFolder = usePlayerStore((s) => s.importFolder);
  const syncImportFolders = usePlayerStore((s) => s.syncImportFolders);
  const folders = settings.importFolders ?? [];
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (!hasFolderAccess()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.importFoldersTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-xs">{t("settings.importFoldersDesktopOnly")}</p>
        </CardContent>
      </Card>
    );
  }

  const setName = (setId: string) => sessions.find((s) => s.id === setId)?.name ?? setId;
  const formatWhen = (ms: number) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(ms);
  const handleReset = async () => {
    setResetting(true);
    try {
      const result = await resetImportedFolders();
      notify.success(
        t("settings.importFoldersResetDone", {
          folders: result.foldersRemoved,
          tracks: result.tracksDeleted,
        }),
      );
    } catch (error) {
      notify.error(t("settings.importFoldersResetFailed"), {
        error,
        source: "folder-import-reset",
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("settings.importFoldersTitle")}</CardTitle>
          <Button
            type="button"
            size="sm"
            disabled={isUploading}
            onClick={() => void importFolder()}
          >
            <FolderPlus /> {t("settings.importFolderAdd")}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">{t("settings.importFoldersDesc")}</p>

          {folders.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t("settings.importFoldersEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {folders.map((folder) => (
                <li key={folder.id} className="rounded-md border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-sm">
                          {folder.displayName ?? folder.path}
                        </p>
                        <p className="truncate text-muted-foreground text-xs">{folder.path}</p>
                        <p className="truncate text-muted-foreground text-xs">
                          {t("settings.importFolderBoundSet", { name: setName(folder.setId) })}
                          {" · "}
                          {folder.lastScanAt
                            ? t("settings.importFolderLastSynced", {
                                when: formatWhen(folder.lastScanAt),
                              })
                            : t("settings.importFolderNeverSynced")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("settings.importFolderRemove")}
                        onClick={() => void removeImportFolder(folder.id)}
                      >
                        <FolderX />
                      </Button>
                    </div>
                    <label className="mt-3 flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={folder.recursive ?? true}
                        disabled={isUploading}
                        onChange={(event) =>
                          void updateImportFolder(folder.id, {
                            recursive: event.currentTarget.checked,
                          })
                        }
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium">{t("settings.importFolderRecursive")}</span>
                        <span className="text-muted-foreground">
                          {t("settings.importFolderRecursiveHint")}
                        </span>
                      </span>
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            {folders.length > 0 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUploading}
                  onClick={() => void syncImportFolders()}
                >
                  <RefreshCw /> {t("settings.importFolderSyncNow")}
                </Button>
                <Button
                  type="button"
                  variant="destructive-outline"
                  size="sm"
                  disabled={isUploading || resetting}
                  onClick={() => setResetOpen(true)}
                >
                  <Trash2 /> {t("settings.importFoldersReset")}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("settings.importFoldersResetTitle")}
        description={t("settings.importFoldersResetBody")}
        confirm={{
          label: t("settings.importFoldersResetConfirm"),
          onConfirm: handleReset,
          variant: "destructive",
        }}
      />
    </>
  );
}
