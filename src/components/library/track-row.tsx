import {
  Disc3,
  Download,
  Heart,
  ListPlus,
  Loader2,
  Trash2,
  TriangleAlert,
  Video,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  listIndex?: number;
  sessions: DjSession[];
  onPlay: () => void;
  onToggleLike: () => void;
  onDelete: () => void;
  onDownload: () => void;
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
      {track.kind === "video" ? <Video className="size-4" /> : <Disc3 className="size-4" />}
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
  listIndex,
  sessions,
  onPlay,
  onToggleLike,
  onDelete,
  onDownload,
  onAddToSession,
}: TrackRowProps) {
  const { t } = useTranslation();
  const disabled = track.status !== "ready";
  const addTargets = useMemo(
    () => sessions.filter((session) => !session.trackIds.includes(track.id)),
    [sessions, track.id],
  );

  return (
    <div
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors",
        isCurrent ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
        data-muzero-track-row-button
        data-track-index={listIndex}
      >
        <TrackThumb track={track} />
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
      </button>
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
        <button
          type="button"
          onClick={onDownload}
          disabled={track.status !== "ready" || (!track.blobId && !track.remoteMediaUrl)}
          className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          aria-label={t("track.download")}
        >
          <Download className="size-4" />
        </button>
        <AddToSetPopover
          disabled={addTargets.length === 0}
          sessions={addTargets}
          onAddToSession={onAddToSession}
        />
      </div>
    </div>
  );
});

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          <div className="max-h-64 overflow-y-auto">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => {
                  onAddToSession(session.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <Disc3 className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{session.name}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
