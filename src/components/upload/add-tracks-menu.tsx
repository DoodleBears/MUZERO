import { FileMusic, FolderInput, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createSession } from "@/db/repositories";
import { hasFolderAccess } from "@/lib/desktop/bridge";
import { classifyDrop, MEDIA_ACCEPT } from "@/lib/file-drop";
import { usePlayerStore } from "@/stores/player-store";

/**
 * One "add tracks" entry point — both ways in behind a single button: pick
 * individual files (multi-select) or import a whole folder. Desktop folder
 * import remembers + re-syncs the folder; the browser falls back to a
 * `webkitdirectory` one-shot.
 *
 * With `setId` it adds into that playlist. Without it (the 全部歌曲 library view)
 * it lands uploads in a fresh "upload set" — mirroring the sessions-page flow —
 * so songs still belong somewhere and show up in the library.
 */
export function AddTracksMenu({
  setId,
  className,
  size = "sm",
}: {
  setId?: string;
  className?: string;
  size?: ButtonProps["size"];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const addUploads = usePlayerStore((s) => s.addUploads);
  const addUploadsToSet = usePlayerStore((s) => s.addUploadsToSet);
  const setActiveSession = usePlayerStore((s) => s.setActiveSession);
  const importFolder = usePlayerStore((s) => s.importFolder);
  const importFolderIntoSet = usePlayerStore((s) => s.importFolderIntoSet);
  const isUploading = usePlayerStore((s) => s.isUploading);
  const native = hasFolderAccess();
  const itemClass =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent";

  async function addFiles(files: FileList | File[]) {
    if (setId) {
      await addUploadsToSet(setId, files);
      return;
    }
    // Library view: route uploads into a fresh upload set (sessions-page flow).
    const list = Array.from(files);
    if (list.length === 0) return;
    const session = await createSession({
      name: t("sessions.uploadSet"),
      seedPrompt: "",
      config: { autoExtend: false },
      displayMode: "video",
    });
    await setActiveSession(session.id);
    await addUploads(list);
  }

  async function importFolderAction() {
    setOpen(false);
    if (!native) {
      folderRef.current?.click();
      return;
    }
    if (setId) await importFolderIntoSet(setId);
    else await importFolder();
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button size={size} variant="outline" disabled={isUploading} className={className}>
              <Plus className="size-4" /> {t("gallery.addTracks")}
            </Button>
          }
        />
        <PopoverContent className="w-48 p-1">
          <PopoverTitle className="sr-only">{t("gallery.addTracks")}</PopoverTitle>
          <PopoverDescription className="sr-only">{t("gallery.addTracks")}</PopoverDescription>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              fileRef.current?.click();
            }}
          >
            <FileMusic className="size-4 text-muted-foreground" /> {t("queue.addFiles")}
          </button>
          <button type="button" className={itemClass} onClick={() => void importFolderAction()}>
            <FolderInput className="size-4 text-muted-foreground" /> {t("folderImport.cta")}
          </button>
        </PopoverContent>
      </Popover>
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
      {!native && (
        <input
          // `webkitdirectory` isn't in React's input typings — set it on the node.
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
            const media = classifyDrop(all).media; // a folder pick returns everything
            if (media.length) void addFiles(media);
          }}
        />
      )}
    </>
  );
}
