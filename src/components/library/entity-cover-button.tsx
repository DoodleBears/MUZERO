import { useLiveQuery } from "dexie-react-hooks";
import { Disc3, ImagePlus, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverCropDialog } from "@/components/track/cover-crop-dialog";
import { db } from "@/db/muzero-db";
import { clearEntityCover, setEntityCover } from "@/db/repositories";
import type { CropRect, EntityCover, Track } from "@/db/types";
import { useEntityCoverUrl } from "@/hooks/use-media";
import { dragHasFiles, filesFromTransfer, IMAGE_ACCEPT } from "@/lib/file-drop";
import { cn } from "@/lib/utils";
import { CoverContextMenu } from "./cover-context-menu";

/**
 * Editable cover for a DERIVED artist/album entity — the set-detail cover button,
 * adapted. Click / drop / page-wide paste an image → square crop → `setEntityCover`
 * (keyed by the entity projection key). Right-click a custom override to remove it
 * back to the fallback track cover (same as the set cover). Rendered only for REAL
 * entities (the caller passes no `entityKey` for the Unknown / Generated /
 * Various-Artists buckets).
 */
export function EntityCoverButton({
  entityKey,
  kind,
  coverTrack,
  round,
  viewTransitionName,
}: {
  entityKey: string;
  kind: EntityCover["kind"];
  coverTrack: Track | undefined;
  round: boolean;
  /** Set so this cover morphs from the wall card the user tapped (gallery → detail). */
  viewTransitionName?: string;
}) {
  const { t } = useTranslation();
  const coverUrl = useEntityCoverUrl(entityKey, coverTrack);
  const hasOverride = useLiveQuery(
    async () => !!(await db.entityCovers.get(entityKey)),
    [entityKey],
    false,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const Placeholder = round ? User : Disc3;

  function pickImage(files: File[]) {
    const img = files.find((f) => f.type.startsWith("image/"));
    if (img) setCropFile(img);
  }

  async function confirmCrop(crop: CropRect) {
    if (!cropFile || saving) return;
    setSaving(true);
    await setEntityCover({
      entityKey,
      kind,
      blob: cropFile,
      mime: cropFile.type || "image/jpeg",
      crop,
    });
    setCropFile(null);
    setSaving(false);
  }

  // Page-wide paste while on this entity page → crop → set the entity cover.
  // stopPropagation halts the bubble before the window-level GlobalDropZone paste.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA"))
        return;
      const img = filesFromTransfer(e.clipboardData).find((f) => f.type.startsWith("image/"));
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      setCropFile(img);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className="shrink-0">
      <CoverContextMenu hasCover={hasOverride} onRemove={() => void clearEntityCover(entityKey)}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={t("gallery.coverHint")}
          title={t("gallery.coverHint")}
          onDragOver={(e) => {
            if (dragHasFiles(e.dataTransfer?.types)) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            pickImage(filesFromTransfer(e.dataTransfer));
          }}
          className={cn(
            "group relative grid size-20 place-items-center overflow-hidden bg-secondary outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
            round ? "rounded-full" : "rounded-xl",
            dragOver && "ring-2 ring-primary",
          )}
          style={viewTransitionName ? { viewTransitionName } : undefined}
        >
          {coverUrl ? (
            <img src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <Placeholder className="size-7 text-muted-foreground" />
          )}
          <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <ImagePlus className="size-5 text-white" />
          </span>
        </button>
      </CoverContextMenu>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) pickImage(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      {cropFile && (
        <CoverCropDialog
          file={cropFile}
          saving={saving}
          onConfirm={(crop) => void confirmCrop(crop)}
          onCancel={() => setCropFile(null)}
        />
      )}
    </div>
  );
}
