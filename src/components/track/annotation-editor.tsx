import { useLiveQuery } from "dexie-react-hooks";
import { ImagePlus, Images, RefreshCw, Sparkles, Tag, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CurrentTrackAddToSetButton } from "@/components/library/track-add-to-set";
import { CoverCropDialog } from "@/components/track/cover-crop-dialog";
import { LyricsManagerButton } from "@/components/track/lyrics-manager-dialog";
import { TrackMemoryNotesPanel } from "@/components/track/track-memory-notes-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addTrackBackground,
  clearTrackEnrichment,
  deleteImageBlob,
  getSettings,
  getTrackEnrichment,
  listTrackBackgrounds,
  saveSettings,
  setTrackCover,
  setTrackTags,
} from "@/db/repositories";
import type { CropRect, Track } from "@/db/types";
import { runAutoEnrich } from "@/enrich/auto-enrich";
import { resolveEnrichmentProvider } from "@/enrich/registry";
import { useObjectUrls } from "@/hooks/use-media";
import { IMAGE_ACCEPT } from "@/lib/file-drop";
import { formatDuration } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

const NOW_PLAYING_MEMORY_LOAD_DELAY_MS = 180;

/**
 * Per-track annotations: tags, memory notes, and an optional cover
 * photo. "Music carries memories" — these are searchable and steer the DJ.
 * `track` is reactive (Dexie useLiveQuery upstream), so tag edits reflect live.
 */
export const AnnotationEditor = memo(function AnnotationEditor({ track }: { track: Track }) {
  const { t } = useTranslation();
  // Pin-to-time + seek only make sense while THIS track is the one playing.
  // Scalar boolean selector → re-renders only when current-track-ness flips.
  const isCurrentTrack = usePlayerStore(
    (s) => (s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id : undefined) === track.id,
  );
  const [draft, setDraft] = useState(() => ({
    cropFile: null as File | null,
    tagInput: "",
    tagInputOpen: false,
    tagsRef: track.tags,
    trackId: track.id,
    visibleTags: track.tags,
  }));
  const fileRef = useRef<HTMLInputElement | null>(null);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const memoryCreatedAtFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [],
  );
  const formatMemoryCreatedAt = useCallback(
    (createdAt: number) => memoryCreatedAtFormatter.format(createdAt),
    [memoryCreatedAtFormatter],
  );
  const memoryLabels = useMemo(
    () => ({
      composer: {
        addPhoto: t("annotation.addMemoryPhoto"),
        cancel: t("annotation.cancelMemoryEdit"),
        changePhoto: t("annotation.changeMemoryPhoto"),
        notePlaceholder: t("annotation.notePlaceholder"),
        photoInput: t("annotation.memoryPhotoInput"),
        removePhoto: (name: string) => t("annotation.removeMemoryPhoto", { name }),
        save: t("annotation.saveMemory"),
        pinToTime: t("annotation.pinMemoryToTime"),
        clearTime: t("annotation.clearMemoryTime"),
        pinnedAt: (time: string) => t("annotation.memoryPinnedAt", { time }),
      },
      createMemory: t("annotation.createMemory"),
      waterfall: {
        deleteMemory: () => t("annotation.deleteMemory"),
        editMemory: () => t("annotation.editMemory"),
        empty: t("annotation.memoryEmpty"),
        photoAlt: () => t("annotation.memoryPhotoAlt"),
        setCoverFromMemory: () => t("annotation.setMemoryPhotoAsCover"),
        seekToTimestamp: (memory: { atSec?: number | null }) =>
          t("annotation.seekToMemoryTime", { time: formatDuration(memory.atSec ?? 0) }),
      },
    }),
    [t],
  );

  // Reset per-track draft UI on track change. The Now Playing page used to force
  // a full `key={track.id}` remount of this whole subtree (incl. the memory
  // waterfall) on every switch — an expensive reconcile + re-layout. Resetting in
  // place keeps the same "fresh per track" UX without that churn. Do it during
  // render instead of in effects so a switch doesn't pay a second reset commit.
  const trackChanged = draft.trackId !== track.id;
  const tagsChanged = draft.tagsRef !== track.tags;
  const currentDraft =
    trackChanged || tagsChanged
      ? {
          cropFile: trackChanged ? null : draft.cropFile,
          tagInput: trackChanged ? "" : draft.tagInput,
          tagInputOpen: trackChanged ? false : draft.tagInputOpen,
          tagsRef: track.tags,
          trackId: track.id,
          visibleTags: track.tags,
        }
      : draft;
  if (currentDraft !== draft) setDraft(currentDraft);
  const { cropFile, tagInput, tagInputOpen, visibleTags } = currentDraft;

  function updateDraft(patch: Partial<typeof currentDraft>) {
    setDraft((current) => (current.trackId === track.id ? { ...current, ...patch } : current));
  }

  useEffect(() => {
    if (tagInputOpen) tagInputRef.current?.focus();
  }, [tagInputOpen]);

  function addTag(value = tagInput) {
    const tag = value.trim().toLowerCase();
    if (!tag) return;
    const next = Array.from(new Set([...visibleTags, tag]));
    updateDraft({ tagInput: "", visibleTags: next });
    void setTrackTags(track.id, next);
  }

  function removeTag(tag: string) {
    const next = visibleTags.filter((t) => t !== tag);
    updateDraft({ visibleTags: next });
    void setTrackTags(track.id, next);
  }

  function onCoverPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) updateDraft({ cropFile: file }); // open the square cropper before saving
  }

  function saveCover(crop: CropRect) {
    if (!cropFile) return;
    void setTrackCover({
      trackId: track.id,
      blob: cropFile,
      mime: cropFile.type || "image/jpeg",
      crop,
    });
    updateDraft({ cropFile: null });
  }

  return (
    <>
      <div className="mx-auto flex w-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant={tagInputOpen ? "secondary" : "outline"}
            onClick={() => updateDraft({ tagInputOpen: true })}
            aria-label={t("annotation.addTag")}
          >
            <Tag className="size-3.5" />
          </Button>

          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="flex h-8 items-center gap-1 rounded-full border border-border bg-card/55 px-2.5 text-xs"
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

          {tagInputOpen && (
            <input
              ref={tagInputRef}
              value={tagInput}
              onChange={(e) => updateDraft({ tagInput: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                }
                if (e.key === "Escape") {
                  updateDraft({ tagInput: "", tagInputOpen: false });
                }
              }}
              onBlur={() => {
                addTag();
                if (!tagInput.trim()) updateDraft({ tagInputOpen: false });
              }}
              placeholder={t("annotation.addTag")}
              className="h-8 min-w-28 rounded-full border border-border bg-card/55 px-3 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="grid size-8 place-items-center rounded-md border border-border bg-card/55 text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={
                track.coverBlobId ? t("annotation.changeCover") : t("annotation.addCover")
              }
            >
              <ImagePlus className="size-3.5" />
            </button>
            <CurrentTrackAddToSetButton
              trackId={track.id}
              buttonClassName="size-8 rounded-md border border-border bg-card/55 hover:bg-card"
              iconClassName="size-3.5"
            />
            <TrackBackgroundManager trackId={track.id} />
            <LyricsManagerButton track={track} />
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_ACCEPT}
              hidden
              onChange={onCoverPicked}
            />
          </div>
        </div>

        <TrackGenreChips track={track} />

        <TrackMemoryNotesPanel
          formatCreatedAt={formatMemoryCreatedAt}
          getCurrentPositionSec={
            isCurrentTrack ? () => usePlayerStore.getState().positionSec : undefined
          }
          onSeekToMemory={
            isCurrentTrack
              ? (memory) => {
                  if (memory.atSec != null) usePlayerStore.getState().seek(memory.atSec);
                }
              : undefined
          }
          labels={memoryLabels}
          loadDelayMs={NOW_PLAYING_MEMORY_LOAD_DELAY_MS}
          trackId={track.id}
        />
      </div>
      {cropFile && (
        <CoverCropDialog
          file={cropFile}
          onConfirm={saveCover}
          onCancel={() => updateDraft({ cropFile: null })}
        />
      )}
    </>
  );
});

/**
 * Read-only external genre enrichment (MusicBrainz/QQ/Last.fm) — shown distinctly from the
 * user's own tags (dashed, no `#`, a Sparkles marker) so auto-fetched style never gets confused
 * with "music carries memories" tags. A manual re-fetch clears the row (incl. the negative
 * cache) and looks it up again. Hidden for generated tracks (they carry brief genre).
 */
function TrackGenreChips({ track }: { track: Track }) {
  const { t } = useTranslation();
  const enrichment = useLiveQuery(() => getTrackEnrichment(track.id), [track.id]);
  const [busy, setBusy] = useState(false);

  const genres =
    enrichment?.status === "found" ? [...enrichment.genres, ...(enrichment.styles ?? [])] : [];

  async function reEnrich() {
    setBusy(true);
    try {
      await clearTrackEnrichment(track.id);
      const settings = await getSettings();
      await runAutoEnrich({ track, settings, provider: resolveEnrichmentProvider(settings) });
    } finally {
      setBusy(false);
    }
  }

  if (track.origin === "generated") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Sparkles className="size-3.5 text-muted-foreground" aria-label={t("annotation.autoGenre")} />
      {genres.map((g) => (
        <span
          key={g}
          className="flex h-8 items-center rounded-full border border-dashed border-border bg-card/40 px-2.5 text-xs text-muted-foreground"
        >
          {g}
        </span>
      ))}
      {genres.length === 0 && (
        <span className="text-xs text-muted-foreground">
          {enrichment?.status === "notFound"
            ? t("annotation.genreNotFound")
            : t("annotation.genrePending")}
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="ml-auto"
        disabled={busy}
        onClick={() => void reEnrich()}
      >
        <RefreshCw className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
        {t("annotation.reEnrich")}
      </Button>
    </div>
  );
}

function TrackBackgroundManager({ trackId }: { trackId: string }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const backgrounds = useLiveQuery(
    () => (open ? listTrackBackgrounds(trackId) : Promise.resolve([])),
    [open, trackId],
    [],
  );
  const blobs = useMemo(
    () => backgrounds.map((bg) => bg.blob).filter((blob): blob is Blob => Boolean(blob)),
    [backgrounds],
  );
  const urls = useObjectUrls(blobs);

  async function addImages(files: File[]) {
    for (const file of files) {
      await addTrackBackground({
        trackId,
        blob: file,
        mime: file.type || "image/jpeg",
      });
    }
    if (files.length) await saveSettings({ backgroundMode: "slideshow" });
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <button
        type="button"
        className="relative grid size-8 place-items-center rounded-md border border-border bg-card/55 text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
        aria-label={t("background.trackSlideshow")}
      >
        <Images className="size-3.5" />
      </button>
      <DialogContent className="max-h-[min(36rem,calc(100vh-2rem))] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle>{t("background.trackSlideshow")}</DialogTitle>
            <DialogDescription className="mt-2">
              {t("background.trackSlideshowDesc")}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label={t("drop.close")}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </DialogClose>
        </div>

        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            <ImagePlus className="size-3.5" />
            {t("background.addTrackImages")}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            if (files.length) void addImages(files);
          }}
        />

        {backgrounds.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
            {t("background.trackSlideshowEmpty")}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {backgrounds.map((bg, i) => (
              <div
                key={bg.id}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border"
              >
                <img src={urls[i]} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => void deleteImageBlob(bg.id)}
                  aria-label={t("background.removeTrackImage")}
                  className="absolute right-1 top-1 rounded-full bg-background/85 p-1 opacity-100 shadow-sm transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <X className="size-3.5 text-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
