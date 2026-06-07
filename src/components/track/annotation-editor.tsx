import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverCropDialog } from "@/components/track/cover-crop-dialog";
import { TrackMemoryNotesPanel } from "@/components/track/track-memory-notes-panel";
import { setTrackCover, setTrackTags } from "@/db/repositories";
import type { CropRect, Track } from "@/db/types";
import { IMAGE_ACCEPT } from "@/lib/file-drop";

/**
 * Per-track annotations: tags, a freeform memory note, and an optional cover
 * photo. "Music carries memories" — these are searchable and steer the DJ.
 * `track` is reactive (Dexie useLiveQuery upstream), so tag edits reflect live.
 */
export function AnnotationEditor({ track }: { track: Track }) {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function addTag() {
    const value = tagInput.trim().toLowerCase();
    if (!value) return;
    void setTrackTags(track.id, [...track.tags, value]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    void setTrackTags(
      track.id,
      track.tags.filter((t) => t !== tag),
    );
  }

  function onCoverPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setCropFile(file); // open the square cropper before saving
  }

  function saveCover(crop: CropRect) {
    if (!cropFile) return;
    void setTrackCover({
      trackId: track.id,
      blob: cropFile,
      mime: cropFile.type || "image/jpeg",
      crop,
    });
    setCropFile(null);
  }

  return (
    <>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/80 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("annotation.memory")}
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ImagePlus className="size-3.5" />
            {track.coverBlobId ? t("annotation.changeCover") : t("annotation.addCover")}
          </button>
          <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={onCoverPicked} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {track.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
            >
              #{tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={t("annotation.removeTag", { tag })}
              >
                <X className="size-3 text-muted-foreground hover:text-foreground" />
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            placeholder={t("annotation.addTag")}
            className="min-w-20 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>

        <TrackMemoryNotesPanel
          formatCreatedAt={(createdAt) =>
            new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(createdAt)
          }
          labels={{
            composer: {
              addPhoto: t("annotation.addMemoryPhoto"),
              cancel: t("annotation.cancelMemoryEdit"),
              changePhoto: t("annotation.changeMemoryPhoto"),
              notePlaceholder: t("annotation.notePlaceholder"),
              photoInput: t("annotation.memoryPhotoInput"),
              removePhoto: (name) => t("annotation.removeMemoryPhoto", { name }),
              save: t("annotation.saveMemory"),
            },
            waterfall: {
              deleteMemory: () => t("annotation.deleteMemory"),
              editMemory: () => t("annotation.editMemory"),
              empty: t("annotation.memoryEmpty"),
              photoAlt: () => t("annotation.memoryPhotoAlt"),
            },
          }}
          trackId={track.id}
        />
      </div>
      {cropFile && (
        <CoverCropDialog file={cropFile} onConfirm={saveCover} onCancel={() => setCropFile(null)} />
      )}
    </>
  );
}
