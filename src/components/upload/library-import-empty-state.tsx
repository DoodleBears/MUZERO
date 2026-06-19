import { FileMusic, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AddTracksMenu } from "@/components/upload/add-tracks-menu";
import { ImportFolderButton } from "@/components/upload/import-folder-button";
import { SetPickerDialog } from "@/components/upload/set-picker-dialog";
import { desktopKind } from "@/lib/desktop/bridge";
import { MEDIA_ACCEPT } from "@/lib/file-drop";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

type LibraryImportActionsMode = "menu" | "direct";

export function LibraryImportEmptyState({
  className,
  compact = false,
  showAddTracks = true,
  actions = "menu",
  setId,
}: {
  className?: string;
  compact?: boolean;
  showAddTracks?: boolean;
  actions?: LibraryImportActionsMode;
  setId?: string;
}) {
  const { t } = useTranslation();

  return (
    <section
      data-testid="library-import-empty-state"
      className={cn(
        "mx-auto flex w-full max-w-xl flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-background/45 px-5 text-center shadow-sm backdrop-blur-sm",
        compact ? "min-h-72 gap-3 py-6" : "min-h-[22rem] gap-4 py-8",
        className,
      )}
    >
      <div className="grid size-12 place-items-center rounded-full bg-primary/12 text-primary">
        <UploadCloud className="size-6" aria-hidden="true" />
      </div>
      <div className="max-w-sm space-y-1.5">
        <h2 className="font-semibold text-base text-foreground">{t("sessions.uploadTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("sessions.uploadDesc")}</p>
      </div>
      {showAddTracks && (
        <LibraryImportActions mode={actions} setId={setId} className="justify-center" />
      )}
      <p className="max-w-sm text-muted-foreground text-xs">{t("drop.addSubtitle")}</p>
    </section>
  );
}

export function LibraryImportActions({
  mode = "menu",
  setId,
  className,
}: {
  mode?: LibraryImportActionsMode;
  setId?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const addUploadsToSet = usePlayerStore((s) => s.addUploadsToSet);
  const isUploading = usePlayerStore((s) => s.isUploading);
  const folderLabelKey =
    desktopKind() === "electron" ? "folderImport.linkLocalFolder" : "folderImport.chooseFolder";

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (setId) {
      await addUploadsToSet(setId, list);
      return;
    }
    setPendingFiles(list);
  }

  const ignoreUploaded = () => undefined;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {mode === "menu" ? (
        <AddTracksMenu setId={setId} />
      ) : (
        <>
          <ImportFolderButton
            setId={setId}
            variant="default"
            className="min-w-40"
            labelKey={folderLabelKey}
            onWebFiles={(files) => addFiles(files)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={isUploading}
            onClick={() => fileRef.current?.click()}
          >
            <FileMusic className="size-4" /> {t("folderImport.chooseFiles")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      )}
      {pendingFiles && (
        <SetPickerDialog
          files={pendingFiles}
          defaultNewSetName={t("sessions.uploadSet")}
          activateNewSet
          onClose={() => setPendingFiles(null)}
          onUploaded={ignoreUploaded}
        />
      )}
    </div>
  );
}
