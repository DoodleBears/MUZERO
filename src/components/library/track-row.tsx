import { Disc3, Heart, Loader2, Trash2, TriangleAlert, Video } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { trackSubtitle } from "@/lib/track-display";
import { cn, formatDuration } from "@/lib/utils";

interface TrackRowProps {
  track: Track;
  isCurrent: boolean;
  onPlay: () => void;
  onToggleLike: () => void;
  onDelete: () => void;
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

export const TrackRow = memo(function TrackRow({
  track,
  isCurrent,
  onPlay,
  onToggleLike,
  onDelete,
}: TrackRowProps) {
  const { t } = useTranslation();
  const disabled = track.status !== "ready";
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors",
        isCurrent ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
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
          {track.tags.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {track.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-secondary/70 px-1.5 text-[10px] text-muted-foreground"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={onToggleLike}
            className="rounded p-1"
            aria-label={t("track.like")}
          >
            <Heart
              className={cn(
                "size-4",
                track.liked ? "fill-primary text-primary" : "text-muted-foreground",
              )}
            />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1"
            aria-label={t("track.delete")}
          >
            <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {track.status === "ready" ? formatDuration(track.durationSec) : "—"}
        </span>
      </div>
    </div>
  );
});
