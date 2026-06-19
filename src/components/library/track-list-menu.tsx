import { FolderInput, ListChecks, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { hasFolderAccess } from "@/lib/desktop/bridge";
import { classifyDrop, MEDIA_ACCEPT } from "@/lib/file-drop";
import { usePlayerStore } from "@/stores/player-store";
import { warmMediaProbeWorker } from "@/workers/media-probe-client";

interface TrackListMenuProps {
  /** Upload target set. Omit → import into the active set (create one if none). */
  setId?: string;
  /** Layout classes for the right-click region (it wraps the list, so it must
   *  carry the sizing the list expects, e.g. `min-h-0 flex-1`). */
  className?: string;
  /** When provided, adds a "Select / Done" item that toggles multi-select mode. */
  selectMode?: boolean;
  onToggleSelectMode?: () => void;
  children: ReactNode;
}

/**
 * Wraps a track list with a right-click menu offering "upload songs" + "import
 * folder". Uploads go to `setId` when given, else the active set (a new upload set
 * is created if nothing is active). Desktop uses the native folder picker; the web
 * build falls back to an `<input webkitdirectory>` (one-shot, no remembering).
 */
export function TrackListMenu({
  setId,
  className,
  selectMode,
  onToggleSelectMode,
  children,
}: TrackListMenuProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const native = hasFolderAccess();

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    void warmMediaProbeWorker();
    const store = usePlayerStore.getState();
    if (setId) await store.addUploadsToSet(setId, files);
    else await store.ingestDroppedMedia(files, t("sessions.uploadSet"));
  }

  function onImportFolder() {
    if (!native) {
      folderRef.current?.click();
      return;
    }
    const store = usePlayerStore.getState();
    void (setId ? store.importFolderIntoSet(setId) : store.importFolder());
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className={className}>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => fileRef.current?.click()}>
            <Upload /> {t("queue.addFiles")}
          </ContextMenuItem>
          <ContextMenuItem onClick={onImportFolder}>
            <FolderInput /> {t("folderImport.cta")}
          </ContextMenuItem>
          {onToggleSelectMode ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onToggleSelectMode}>
                <ListChecks /> {selectMode ? t("select.done") : t("select.enter")}
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
      <input
        ref={fileRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          void uploadFiles(files);
        }}
      />
      {!native && (
        <input
          ref={(el) => {
            folderRef.current = el;
            el?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const all = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            void uploadFiles(classifyDrop(all).media);
          }}
        />
      )}
    </>
  );
}
