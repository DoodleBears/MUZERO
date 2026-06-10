import {
  Download,
  Heart,
  ListPlus,
  Loader2,
  Play,
  Trash2,
  TriangleAlert,
  Video,
} from "lucide-react";
import { Fragment, type KeyboardEvent, type MouseEvent, memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, type CommandItem } from "@/components/ui/command";
import { CoverImage } from "@/components/ui/cover-image";
import { Disc3Icon } from "@/components/ui/disc-3";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DjSession, Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { trackAlbum, trackArtists, trackSubtitle } from "@/lib/track-display";
import { cn, formatDuration } from "@/lib/utils";
import { useNavStore } from "@/stores/nav-store";

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
  onAddToSession: (sessionId: string) => void;
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
  onAddToSession,
}: TrackRowProps) {
  const { t } = useTranslation();
  const disabled = track.status !== "ready";
  const addTargets = useMemo(
    () => sessions.filter((session) => !session.trackIds.includes(track.id)),
    [sessions, track.id],
  );

  // Two-tap activation: the first interaction selects the row (revealing its
  // info in the inspector); interacting again with an already-selected row that
  // isn't the one playing switches playback to it. Lists without a selection
  // model (queue / Now Playing) leave `isSelected` undefined, so `onView` is the
  // play handler there and a single click plays straight away.
  function activate(shiftKey = false) {
    if (selectable) {
      onToggleSelect?.(shiftKey);
      return;
    }
    if (isSelected && !isCurrent && !disabled) {
      onPlay();
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
    activate(event.shiftKey);
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
              onPlay();
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
          <Heart className={cn("size-4", track.liked && "fill-primary text-primary")} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
          aria-label={t("track.delete")}
        >
          <Trash2 className="size-4" />
        </button>
        <DownloadPopover
          disabled={track.status !== "ready" || (!track.blobId && !track.remoteMediaUrl)}
          onDownloadOriginal={onDownloadOriginal}
          onExportWithMetadata={onExportWithMetadata}
        />
        <AddToSetPopover
          disabled={addTargets.length === 0}
          sessions={addTargets}
          onAddToSession={onAddToSession}
        />
      </div>
    </div>
  );
});

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
        <Download className="size-4" />
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

function AddToSetPopover({
  disabled,
  sessions,
  onAddToSession,
}: {
  disabled: boolean;
  sessions: DjSession[];
  onAddToSession: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const items = useMemo<CommandItem[]>(
    () =>
      sessions.map((session) => ({
        id: session.id,
        keywords: [session.name, session.description ?? ""],
        label: session.name,
      })),
    [sessions],
  );

  function selectSession(sessionId: string) {
    onAddToSession(sessionId);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <PopoverTrigger
        type="button"
        disabled={disabled}
        className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        aria-label={t("track.addToSet")}
        title={disabled ? t("track.noOtherSets") : t("track.addToSet")}
      >
        <ListPlus className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" side="left" sideOffset={10}>
        <PopoverTitle className="px-2 py-1.5">{t("track.addToSet")}</PopoverTitle>
        {sessions.length === 0 ? (
          <PopoverDescription className="px-2 py-1.5 text-xs">
            {t("track.noOtherSets")}
          </PopoverDescription>
        ) : (
          <Command
            className="border-0"
            empty={t("track.noMatchingSets")}
            inputValue={query}
            items={items}
            onInputChange={setQuery}
            onSelect={selectSession}
            placeholder={t("track.searchSets")}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
