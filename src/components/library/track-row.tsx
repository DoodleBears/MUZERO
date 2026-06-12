import { Heart, Loader2, Play, TriangleAlert, Video } from "lucide-react";
import { Fragment, type KeyboardEvent, type MouseEvent, memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SourceAttributionChip } from "@/components/cloud/source-attribution-chip";
import { TrackAddToSetPopover } from "@/components/library/track-add-to-set";
import { Checkbox } from "@/components/ui/checkbox";
import { CloudDownloadIcon } from "@/components/ui/cloud-download";
import { CoverImage } from "@/components/ui/cover-image";
import { DeleteIcon } from "@/components/ui/delete";
import { Disc3Icon } from "@/components/ui/disc-3";
import { DownloadIcon } from "@/components/ui/download";
import { HeartIcon } from "@/components/ui/heart";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DjSession, Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { recordUserAction } from "@/lib/logger";
import { trackAlbum, trackArtists, trackSubtitle } from "@/lib/track-display";
import { cn, formatDuration } from "@/lib/utils";
import { useNavStore } from "@/stores/nav-store";
import { useIsStreamDownloading } from "@/stores/stream-cache-store";
import { isTrackCacheableToDevice } from "@/streamsrc/source-detect";

interface TrackRowProps {
  track: Track;
  isCurrent: boolean;
  isSelected?: boolean;
  /** Select mode: show a checkbox; activating the row toggles its selection.
   *  `shiftKey` requests a range select from the last-toggled anchor. */
  selectable?: boolean;
  checked?: boolean;
  onToggleSelect?: (shiftKey: boolean) => void;
  listIndex?: number;
  sessions: DjSession[];
  onPlay: () => void;
  onView: () => void;
  onToggleLike: () => void;
  onDelete: () => void;
  onDownloadOriginal: () => void;
  onExportWithMetadata: () => void;
  /** Cache a streamed (online) track to a local blob — shown instead of the export
   *  popover for streamed tracks that aren't downloaded yet. */
  onDownloadToDevice?: () => void;
  onAddToSession: (sessionId: string) => void;
  /** Create a brand-new set named `name` and add this track to it. */
  onAddToNewSession: (name: string) => void;
}

/** A clickable artist/album segment in a track's subtitle → opens that entity in
 *  the library. Stops propagation so it never triggers the row's play/select. */
function EntityLink({ onOpen, children }: { onOpen: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className="rounded outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
    >
      {children}
    </button>
  );
}

/**
 * Track subtitle with clickable artist(s) + album when embedded metadata exists
 * (any track surface → jump to the library entity). Falls back to the plain
 * caption/note/title line for generated or untagged tracks.
 */
function TrackSubtitle({ track }: { track: Track }) {
  const artists = trackArtists(track);
  const album = trackAlbum(track);
  if (artists.length === 0 && !album) return <>{trackSubtitle(track)}</>;
  return (
    <>
      {artists.map((name, index) => (
        <Fragment key={name}>
          {index > 0 && ", "}
          <EntityLink onOpen={() => useNavStore.getState().openArtist(name)}>{name}</EntityLink>
        </Fragment>
      ))}
      {artists.length > 0 && album && <span aria-hidden> · </span>}
      {album && (
        <EntityLink onOpen={() => useNavStore.getState().openAlbumForTrack(track.id)}>
          {album}
        </EntityLink>
      )}
    </>
  );
}

/** Shown in the thumbnail slot while a track is still pending/generating/failed. */
function StatusBadge({ status }: { status: Track["status"] }) {
  if (status === "failed") return <TriangleAlert className="size-4 text-destructive" />;
  return <Loader2 className="size-4 animate-spin text-primary" />;
}

/** YouTube-Music-style row thumbnail: cover image, else a kind icon / status. */
function TrackThumb({ track }: { track: Track }) {
  const coverUrl = useTrackCoverUrl(track);
  if (track.status !== "ready") {
    return (
      <div className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary">
        <StatusBadge status={track.status} />
      </div>
    );
  }
  return (
    <CoverImage
      url={coverUrl}
      thumbhash={track.coverThumbhash}
      placeholder={track.kind === "video" ? <Video className="size-4" /> : <Disc3Icon size={16} />}
      className="size-10 shrink-0 rounded-md text-muted-foreground"
    />
  );
}

function TrackTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;

  return (
    <div className="hidden max-w-52 flex-wrap justify-end gap-1 lg:flex">
      {tags.slice(0, 4).map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-secondary/70 px-1.5 text-[10px] text-muted-foreground"
        >
          #{tag}
        </span>
      ))}
    </div>
  );
}

export const TrackRow = memo(function TrackRow({
  track,
  isCurrent,
  isSelected,
  selectable,
  checked,
  onToggleSelect,
  listIndex,
  sessions,
  onPlay,
  onView,
  onToggleLike,
  onDelete,
  onDownloadOriginal,
  onExportWithMetadata,
  onDownloadToDevice,
  onAddToSession,
  onAddToNewSession,
}: TrackRowProps) {
  const { t } = useTranslation();
  const disabled = track.status !== "ready";

  // Two-tap activation: the first interaction selects the row (revealing its
  // info in the inspector); interacting again with an already-selected row that
  // isn't the one playing switches playback to it. Lists without a selection
  // model (queue / Now Playing) leave `isSelected` undefined, so `onView` is the
  // play handler there and a single click plays straight away.
  function requestPlay(actionKind: "click" | "keyboard") {
    recordUserAction("play.click", {
      message: "track play clicked",
      trackId: track.id,
      sessionId: track.sessionId,
      uiSurface: "track-row",
      controlId: "track.play",
      actionKind,
    });
    onPlay();
  }

  function activate(shiftKey = false, actionKind: "click" | "keyboard" = "click") {
    if (selectable) {
      onToggleSelect?.(shiftKey);
      return;
    }
    if (isSelected && !isCurrent && !disabled) {
      requestPlay(actionKind);
      return;
    }
    onView();
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Activate on Enter/Space and on D/→ (the WASD library "drill in" keys).
    const k = event.key.toLowerCase();
    if (k !== "enter" && k !== " " && k !== "d" && k !== "arrowright") return;
    event.preventDefault();
    event.stopPropagation();
    activate(event.shiftKey, "keyboard");
  }

  function eventStartedInActions(event: MouseEvent<HTMLDivElement>) {
    return (
      event.target instanceof HTMLElement && !!event.target.closest("[data-muzero-row-actions]")
    );
  }

  function handleRowClick(event: MouseEvent<HTMLDivElement>) {
    if (eventStartedInActions(event)) return;
    activate(event.shiftKey);
  }

  // The two single clicks of a double-click already run select-then-play (the
  // selection update is flushed synchronously, so the second click sees it);
  // this only stops the double-click from selecting the row's text.
  function handleRowDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (eventStartedInActions(event)) return;
    event.preventDefault();
  }

  return (
    <div
      aria-selected={isSelected || undefined}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors outline-none",
        isCurrent ? "bg-accent" : isSelected ? "bg-accent/60" : "hover:bg-accent/50",
        selectable && "select-none",
      )}
      data-muzero-track-row
      data-track-index={listIndex}
      onClick={handleRowClick}
      onDoubleClick={handleRowDoubleClick}
      onKeyDown={handleRowKeyDown}
      role="option"
      tabIndex={0}
    >
      {selectable && (
        <Checkbox checked={checked ?? false} className="pointer-events-none ms-0.5 shrink-0" />
      )}
      <div className="group/thumb relative size-10 shrink-0">
        <div className="grid size-10 place-items-center rounded-md">
          <TrackThumb track={track} />
        </div>
        {track.status === "ready" && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              requestPlay("click");
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className="pointer-events-none absolute inset-0 grid place-items-center rounded-md bg-black/45 text-foreground opacity-0 outline-none transition-opacity group-hover/thumb:pointer-events-auto group-hover/thumb:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("player.play")}
          >
            <span className="grid size-7 place-items-center rounded-full bg-background shadow-sm">
              <Play className="ms-0.5 size-3.5 fill-current" />
            </span>
          </button>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center gap-1.5 truncate text-sm font-medium",
              isCurrent && "text-primary",
            )}
          >
            <span className="truncate">{track.title}</span>
            {track.kind === "video" && <Video className="size-3 shrink-0 text-muted-foreground" />}
            {track.cloudSource && (
              <SourceAttributionChip
                source={track.cloudSource}
                fallback={t("track.cloudSourceUnknown")}
                compact
                className="hidden max-w-32 lg:inline-flex"
              />
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {track.status === "failed" ? (
              (track.error ?? t("track.generationFailed"))
            ) : (
              <TrackSubtitle track={track} />
            )}
          </div>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <TrackTags tags={track.tags} />
        {/* Persistent at-a-glance "liked" hint, left of the duration (the hover
            toolbar carries the actual toggle). */}
        {track.liked && <Heart className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {track.status === "ready" ? formatDuration(track.durationSec) : "—"}
        </span>
      </div>
      <div
        className={cn(
          "invisible absolute right-3 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-border bg-background/95 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity",
          "group-hover:visible group-hover:opacity-100 focus-within:visible focus-within:opacity-100",
        )}
        data-muzero-row-actions
      >
        <button
          type="button"
          onClick={onToggleLike}
          className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("track.like")}
          aria-pressed={track.liked}
        >
          {/* Liked color goes on the icon (a descendant) so it cleanly overrides the
              button's inherited muted color instead of fighting it on one element. */}
          <HeartIcon size={16} className={cn(track.liked && "text-primary [&_svg]:fill-primary")} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
          aria-label={t("track.delete")}
        >
          <DeleteIcon size={16} />
        </button>
        {isTrackCacheableToDevice(track) ? (
          // Online/R2 track with no local copy yet → fetch it from the cloud into a
          // local blob (cloud-download glyph), not a disabled export menu.
          <DownloadToDeviceButton trackId={track.id} onDownload={onDownloadToDevice} />
        ) : track.status === "ready" && track.origin === "streamed" ? (
          // Streamed track now cached locally → one click saves the file straight to
          // disk (no metadata-vs-original menu; the bytes are the source recording).
          <DirectDownloadButton onDownload={onDownloadOriginal} />
        ) : (
          <DownloadPopover
            disabled={track.status !== "ready" || (!track.blobId && !track.remoteMediaUrl)}
            onDownloadOriginal={onDownloadOriginal}
            onExportWithMetadata={onExportWithMetadata}
          />
        )}
        <TrackAddToSetPopover
          trackId={track.id}
          sessions={sessions}
          onAddToSession={onAddToSession}
          onAddToNewSession={onAddToNewSession}
        />
      </div>
    </div>
  );
});

/** Download-to-device button for a streamed track with no local copy: one click
 *  fetches its bytes from the cloud into a local blob (offline play + stable cover-
 *  color extraction). A cloud-download glyph — distinct from the file-export icon —
 *  marks "fetch the audio first"; once cached the row swaps to the export popover so
 *  the same row can then save the local file to disk. Spinner while in flight. */
function DownloadToDeviceButton({
  trackId,
  onDownload,
}: {
  trackId: string;
  onDownload?: () => void;
}) {
  const { t } = useTranslation();
  const downloading = useIsStreamDownloading(trackId);
  return (
    <button
      type="button"
      onClick={onDownload}
      disabled={downloading || !onDownload}
      className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
      aria-label={t("track.downloadToDevice")}
      title={t("track.downloadToDevice")}
    >
      {downloading ? <Loader2 className="size-4 animate-spin" /> : <CloudDownloadIcon size={16} />}
    </button>
  );
}

/** Direct file-download button for a streamed track already cached to a local blob:
 *  one click saves the audio file to disk (the cloud→device step is done, so this is
 *  the plain "download the file" action, no original-vs-metadata menu). */
function DirectDownloadButton({ onDownload }: { onDownload: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onDownload}
      className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label={t("track.download")}
      title={t("track.download")}
    >
      <DownloadIcon size={16} />
    </button>
  );
}

function DownloadPopover({
  disabled,
  onDownloadOriginal,
  onExportWithMetadata,
}: {
  disabled: boolean;
  onDownloadOriginal: () => void;
  onExportWithMetadata: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const itemClass =
    "w-full rounded px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        aria-label={t("track.download")}
      >
        <DownloadIcon size={16} />
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" side="left" sideOffset={10}>
        <PopoverTitle className="sr-only">{t("track.download")}</PopoverTitle>
        <PopoverDescription className="sr-only">{t("track.download")}</PopoverDescription>
        <button
          type="button"
          className={itemClass}
          onClick={() => {
            onDownloadOriginal();
            setOpen(false);
          }}
        >
          {t("track.downloadOriginal")}
        </button>
        <button
          type="button"
          className={itemClass}
          onClick={() => {
            onExportWithMetadata();
            setOpen(false);
          }}
        >
          {t("track.exportWithMetadata")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
