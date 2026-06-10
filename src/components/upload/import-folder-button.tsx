import { FolderInput } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { hasFolderAccess } from "@/lib/desktop/bridge";
import { classifyDrop } from "@/lib/file-drop";
import { usePlayerStore } from "@/stores/player-store";

interface ImportFolderButtonProps {
  /**
   * Browser fallback handler for the picked folder's media files. Desktop ignores
   * this — it routes through the store's `importFolder()` (remember + sync). The
   * web `webkitdirectory` input can't expose a re-openable absolute path, so it's
   * a one-shot import with no remembering.
   */
  onWebFiles: (files: File[]) => void | Promise<void>;
  /** Called after a successful import (desktop pick or web files), e.g. to navigate. */
  onImported?: () => void;
  /**
   * Desktop: import into THIS existing set (binds the folder to it for re-sync).
   * Omit to create/reuse the folder's own set (queue / sessions entry points).
   */
  setId?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
}

/**
 * "Import folder" entry point. On desktop it opens the native folder picker and
 * remembers the folder for incremental re-sync; in the browser it degrades to a
 * `<input webkitdirectory>` one-shot import. Same label + busy state either way.
 */
export function ImportFolderButton({
  onWebFiles,
  onImported,
  setId,
  variant = "outline",
  className,
}: ImportFolderButtonProps) {
  const { t } = useTranslation();
  const isUploading = usePlayerStore((s) => s.isUploading);
  const importFolder = usePlayerStore((s) => s.importFolder);
  const importFolderIntoSet = usePlayerStore((s) => s.importFolderIntoSet);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const native = hasFolderAccess();

  async function handleDesktop() {
    const ok = setId ? await importFolderIntoSet(setId) : await importFolder();
    if (ok) onImported?.();
  }

  return (
    <>
      <Button
        variant={variant}
        className={className}
        disabled={isUploading}
        onClick={() => (native ? void handleDesktop() : inputRef.current?.click())}
      >
        <FolderInput /> {isUploading ? t("sessions.importing") : t("folderImport.cta")}
      </Button>
      {!native && (
        <input
          // `webkitdirectory` isn't in React's input typings — set it on the node.
          ref={(el) => {
            inputRef.current = el;
            el?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            // Snapshot synchronously: clearing the input empties the same FileList.
            const all = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            // A folder pick returns everything inside — keep only audio/video.
            const media = classifyDrop(all).media;
            if (media.length) void Promise.resolve(onWebFiles(media)).then(() => onImported?.());
          }}
        />
      )}
    </>
  );
}
