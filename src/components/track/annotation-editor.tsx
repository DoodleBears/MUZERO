import { ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@/components/ui/input";
import { setTrackCover, setTrackNote, setTrackTags } from "@/db/repositories";
import type { Track } from "@/db/types";

/**
 * Per-track annotations: tags, a freeform memory note, and an optional cover
 * photo. "Music carries memories" — these are searchable and steer the DJ.
 * `track` is reactive (Dexie useLiveQuery upstream), so tag edits reflect live.
 */
export function AnnotationEditor({ track }: { track: Track }) {
  const { t } = useTranslation();
  const [note, setNote] = useState(track.note ?? "");
  const [tagInput, setTagInput] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Re-sync the local note when the saved note changes. The parent remounts this
  // component per track (key={track.id}), so switching tracks resets cleanly too.
  useEffect(() => setNote(track.note ?? ""), [track.note]);

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
    if (file)
      void setTrackCover({ trackId: track.id, blob: file, mime: file.type || "image/jpeg" });
    e.target.value = "";
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/40 p-3">
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
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onCoverPicked} />
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

      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => void setTrackNote(track.id, note)}
        placeholder={t("annotation.notePlaceholder")}
        className="min-h-16 text-sm"
      />
    </div>
  );
}
