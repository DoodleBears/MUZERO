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
import { type KeyboardEvent, type MouseEvent, memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Command, type CommandItem } from "@/components/ui/command";
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
import { trackSubtitle } from "@/lib/track-display";
import { cn, formatDuration } from "@/lib/utils";

interface TrackRowProps {
  track: Track;
  isCurrent: boolean;
  isSelected?: boolean;
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
  if (coverUrl) {
    return (
      <div className="size-10 shrink-0 overflow-hidden rounded-md bg-secondary">
        <img src={coverUrl} alt="" className="size-full object-cover" />
      </div>
    );
  }
  return (
    <div className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
      {track.kind === "video" ? <Video className="size-4" /> : <Disc3Icon size={16} />}
    </div>
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

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onView();
  }

  function eventStartedInActions(event: MouseEvent<HTMLDivElement>) {
    return (
      event.target instanceof HTMLElement && !!event.target.closest("[data-muzero-row-actions]")
    );
  }

  function handleRowClick(event: MouseEvent<HTMLDivElement>) {
    if (eventStartedInActions(event)) return;
    onView();
  }

  function handleRowDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (eventStartedInActions(event)) return;
    if (disabled || isSelected) return;
    event.preventDefault();
    onPlay();
  }

  return (
    <div
      aria-selected={isSelected || undefined}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors outline-none",
        isCurrent ? "bg-accent" : isSelected ? "bg-accent/60" : "hover:bg-accent/50",
      )}
      data-muzero-track-row
      data-track-index={listIndex}
      onClick={handleRowClick}
      onDoubleClick={handleRowDoubleClick}
      onKeyDown={handleRowKeyDown}
      role="option"
      tabIndex={0}
    >
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
            {track.status === "failed"
              ? (track.error ?? t("track.generationFailed"))
              : trackSubtitle(track)}
          </div>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <TrackTags tags={track.tags} />
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
