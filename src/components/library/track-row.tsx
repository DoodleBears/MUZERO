import { Heart, Loader2, Play, Star, TriangleAlert, Video, X } from "lucide-react";
import {
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  memo,
  type ReactNode,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { SourceAttributionChip } from "@/components/cloud/source-attribution-chip";
import {
  ManagedTrackAddToSetPopover,
  TrackAddToSetPopover,
} from "@/components/library/track-add-to-set";
import { RatingStars } from "@/components/player/rating-stars";
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
import { clearTrackRating, setTrackRating } from "@/db/repositories";
import type { DjSession, Track } from "@/db/types";
import { useCoverDerivativeUrlWithCropSetting } from "@/hooks/use-media";
import { recordUserAction } from "@/lib/logger";
import { trackAlbum, trackArtists, trackSubtitle } from "@/lib/track-display";
import { formatRatingValue, resolveTrackRating } from "@/lib/track-rating";
import { cn, formatDuration } from "@/lib/utils";
import { useNavStore } from "@/stores/nav-store";
import { useIsStreamDownloading } from "@/stores/stream-cache-store";
import { isTrackCacheableToDevice } from "@/streamsrc/source-detect";

interface TrackRowProps {
  track: Track;
  labels: TrackRowLabels;
  isCurrent: boolean;
  isSelected?: boolean;
  liked?: boolean;
  coverCropped?: boolean;
  deferCoverLoad?: boolean;
  /** Select mode: show a checkbox; activating the row toggles its selection.
   *  `shiftKey` requests a range select from the last-toggled anchor. */
  selectable?: boolean;
  checked?: boolean;
  onToggleSelect?: (shiftKey: boolean) => void;
  listIndex?: number;
  secondaryMeta?: ReactNode;
  metricColumns?: ReactNode;
  sessions?: DjSession[];
  onPlay: () => void;
  onView: () => void;
  onToggleLike: () => void;
  onDelete: () => void;
  onDownloadOriginal: () => void;
  onExportWithMetadata: () => void;
  /** Cache a streamed (online) track to a local blob — shown instead of the export
   *  popover for streamed tracks that aren't downloaded yet. */
  onDownloadToDevice?: () => void;
  onAddToSession?: (sessionId: string) => void;
  /** Create a brand-new set named `name` and add this track to it. */
  onAddToNewSession?: (name: string) => void;
}

export interface TrackRowLabels {
  cloudSourceUnknown: string;
  delete: string;
  downloadFailed: string;
  generationFailed: string;
  like: string;
  play: string;
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
function TrackThumb({
  coverCropped = true,
  deferCoverLoad = false,
  track,
}: {
  coverCropped?: boolean;
  deferCoverLoad?: boolean;
  track: Track;
}) {
  // Pass the track even while scrolling, with defer: keep an already-resolved
  // cover (no flash to thumbhash), just don't START new derivative work mid-scroll.
  const coverUrl = useCoverDerivativeUrlWithCropSetting(track, "thumbnail", coverCropped, {
    defer: deferCoverLoad,
    traceSource: "row:thumbnail",
  });
  if (track.status !== "ready") {
    return (
      <div className="grid size-10 shrink-0 place-items-center bg-secondary album-cover-radius album-cover-shadow">
        <StatusBadge status={track.status} />
      </div>
    );
  }
  return (
    <CoverImage
      url={coverUrl}
      thumbhash={track.coverThumbhash}
      placeholder={track.kind === "video" ? <Video className="size-4" /> : <Disc3Icon size={16} />}
      className="size-10 shrink-0 text-muted-foreground"
    />
  );
}

/** At-a-glance crowd rating: one star + the average (≤1 decimal), next to the
 *  liked heart. Unrated tracks render nothing (no 0-star noise on every row). */
function TrackRatingBadge({ track }: { track: Track }) {
  const rating = resolveTrackRating(track);
  if (!rating) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-secondary/70 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
      data-testid="track-rating-badge"
    >
      <Star className="size-3 fill-primary text-primary" aria-hidden="true" />
      {formatRatingValue(rating.average)}
    </span>
  );
}

/**
 * Hover-toolbar star button + popover for setting THIS device's own rating on a track
 * (the "self" vote — the same rater the Now-Playing chip writes). The star fills when a
 * self vote exists; the popover offers the 1–5 selector plus a clear-my-vote button.
 * Reads the vote straight off `track` (live rows re-render on edit).
 */
function RowRatingPopover({
  track,
  onOpenChange,
}: {
  track: Track;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selfVote = track.ratingsByRater?.self;
  const rateLabel = t("rating.rate", { defaultValue: "Rate" });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange(next);
      }}
    >
      <PopoverTrigger
        type="button"
        className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={rateLabel}
      >
        <Star
          className={cn("size-4", selfVote !== undefined && "fill-primary text-primary")}
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" side="left" sideOffset={10}>
        <PopoverTitle className="sr-only">{rateLabel}</PopoverTitle>
        <PopoverDescription className="sr-only">
          {t("rating.aria", { defaultValue: "Rate this song" })}
        </PopoverDescription>
        <div className="flex items-center gap-1.5">
          <RatingStars
            value={selfVote ?? 0}
            onSelect={(score) => void setTrackRating(track.id, "self", score)}
            label={t("rating.aria", { defaultValue: "Rate this song" })}
          />
          {selfVote !== undefined && (
            <button
              type="button"
              aria-label={t("rating.clear", { defaultValue: "Clear my rating" })}
              title={t("rating.clear", { defaultValue: "Clear my rating" })}
              onClick={() => void clearTrackRating(track.id, "self")}
              className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
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
  labels,
  isCurrent,
  isSelected,
  liked = false,
  coverCropped = true,
  deferCoverLoad,
  selectable,
  checked,
  onToggleSelect,
  listIndex,
  secondaryMeta,
  metricColumns,
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
  const disabled = track.status !== "ready";
  // The hover action toolbar mounts two Base UI Popovers + several buttons. On a
  // virtualized list those are pure scroll cost — invisible until hover, yet
  // instantiated for every mounted row. Mount it only once the row is actually
  // hovered (mouse) or focused (keyboard), so a fast scroll past hundreds of rows
  // never builds the popover machinery. `onMouseEnter` (not pointer) so a touch tap
  // doesn't flash it. Matches the smooth entity grids, which carry no per-card popovers.
  const [showActions, setShowActions] = useState(false);
  const [addToSetOpen, setAddToSetOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const showActionToolbar = showActions || addToSetOpen || ratingOpen;

  // Master-detail activation: a single click / tap (and keyboard row nav) SELECTS the
  // row, revealing it in the inspector WITHOUT interrupting playback; PLAY is its own
  // explicit gesture — double-click, the hover play button, or Enter/Space/D/→. Lists
  // with NO selection model (queue / Now Playing) pass `onView` === the play handler,
  // so a single click there still plays straight away.
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

  // Single click / tap: toggle in select mode, otherwise select (→ inspector).
  function selectRow(shiftKey = false) {
    if (selectable) {
      onToggleSelect?.(shiftKey);
      return;
    }
    onView();
  }

  // Explicit play gesture (double-click / Enter / Space / D / →); no-op while the
  // track isn't ready. Select mode is handled by the callers (a tap toggles there).
  function activatePlay(actionKind: "click" | "keyboard" = "click") {
    if (disabled) return;
    requestPlay(actionKind);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Play on Enter/Space and on D/→ (the WASD library "drill in" keys). Row nav
    // (W/S/↑/↓) already moved the selection, so Enter activates = play it. In select
    // mode the same keys toggle the row's checkbox instead.
    const k = event.key.toLowerCase();
    if (k !== "enter" && k !== " " && k !== "d" && k !== "arrowright") return;
    event.preventDefault();
    event.stopPropagation();
    if (selectable) {
      onToggleSelect?.(event.shiftKey);
      return;
    }
    activatePlay("keyboard");
  }

  function eventStartedInActions(event: MouseEvent<HTMLDivElement>) {
    return (
      event.target instanceof HTMLElement && !!event.target.closest("[data-muzero-row-actions]")
    );
  }

  function handleRowClick(event: MouseEvent<HTMLDivElement>) {
    if (eventStartedInActions(event)) return;
    selectRow(event.shiftKey);
  }

  // Double-click plays (the preceding single clicks already selected the row). The
  // preventDefault also stops the double-click from selecting the row's text. In
  // select mode the clicks toggle the checkbox, so a double-click must not play.
  function handleRowDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (eventStartedInActions(event)) return;
    event.preventDefault();
    if (selectable) return;
    activatePlay("click");
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
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onFocus={() => setShowActions(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setShowActions(false);
        }
      }}
      role="option"
      tabIndex={0}
    >
      {selectable && (
        <Checkbox checked={checked ?? false} className="pointer-events-none ms-0.5 shrink-0" />
      )}
      <div className="group/thumb relative size-10 shrink-0">
        <div className="grid size-10 place-items-center album-cover-radius">
          <TrackThumb coverCropped={coverCropped} deferCoverLoad={deferCoverLoad} track={track} />
        </div>
        {track.status === "ready" && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              requestPlay("click");
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className="pointer-events-none absolute inset-0 grid place-items-center bg-black/45 text-foreground opacity-0 outline-none transition-opacity group-hover/thumb:pointer-events-auto group-hover/thumb:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring album-cover-radius"
            aria-label={labels.play}
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
                fallback={labels.cloudSourceUnknown}
                compact
                className="hidden max-w-32 lg:inline-flex"
              />
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {track.status === "failed" ? (
              (track.error ?? labels.generationFailed)
            ) : (
              <>
                <TrackSubtitle track={track} />
                {secondaryMeta && <span className="ms-1">· {secondaryMeta}</span>}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <TrackTags tags={track.tags} />
        <TrackRatingBadge track={track} />
        {/* Persistent at-a-glance "liked" hint, left of the duration (the hover
            toolbar carries the actual toggle). */}
        {liked && <Heart className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
        {metricColumns && (
          <span className="hidden shrink-0 items-center gap-3 md:inline-flex">{metricColumns}</span>
        )}
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {track.status === "ready" ? formatDuration(track.durationSec) : "—"}
        </span>
      </div>
      {showActionToolbar && (
        <div
          className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-border bg-background/95 p-0.5 shadow-sm backdrop-blur"
          data-muzero-row-actions
        >
          <button
            type="button"
            onClick={onToggleLike}
            className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={labels.like}
            aria-pressed={liked}
          >
            {/* Liked color goes on the icon (a descendant) so it cleanly overrides the
              button's inherited muted color instead of fighting it on one element. */}
            <HeartIcon size={16} className={cn(liked && "text-primary [&_svg]:fill-primary")} />
          </button>
          <RowRatingPopover
            track={track}
            onOpenChange={(open) => {
              setRatingOpen(open);
              if (open) setShowActions(true);
            }}
          />
          <button
            type="button"
            onClick={onDelete}
            className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
            aria-label={labels.delete}
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
          {sessions && onAddToSession && onAddToNewSession ? (
            <TrackAddToSetPopover
              trackId={track.id}
              sessions={sessions}
              onAddToSession={onAddToSession}
              onAddToNewSession={onAddToNewSession}
              onOpenChange={(open) => {
                setAddToSetOpen(open);
                if (open) setShowActions(true);
              }}
            />
          ) : (
            <ManagedTrackAddToSetPopover
              trackId={track.id}
              onOpenChange={(open) => {
                setAddToSetOpen(open);
                if (open) setShowActions(true);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}, trackRowPropsEqual);

/**
 * `TrackRow`'s memo comparator. The list passes fresh inline-arrow handlers every
 * scroll-driven parent render, which would defeat a default `memo` and re-render
 * every visible row each frame. Those handlers' BEHAVIOR is fully determined by the
 * data props below (the `track` object, `listIndex`) plus module-stable store
 * functions, so comparing the data and ignoring callback identity is safe — and on a
 * pure scroll (no DB change) the `track` objects are stable, so rows stop
 * re-rendering entirely; only newly-windowed rows mount. A track edit yields a fresh
 * `track` object, which differs here and re-renders that row with current handlers.
 */
function trackRowPropsEqual(prev: TrackRowProps, next: TrackRowProps): boolean {
  return (
    prev.track === next.track &&
    prev.labels === next.labels &&
    prev.isCurrent === next.isCurrent &&
    prev.isSelected === next.isSelected &&
    prev.liked === next.liked &&
    prev.coverCropped === next.coverCropped &&
    prev.checked === next.checked &&
    prev.selectable === next.selectable &&
    prev.deferCoverLoad === next.deferCoverLoad &&
    prev.listIndex === next.listIndex &&
    prev.sessions === next.sessions &&
    prev.secondaryMeta === next.secondaryMeta &&
    prev.metricColumns === next.metricColumns
  );
}

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
