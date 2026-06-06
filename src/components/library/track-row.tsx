import { Heart, Loader2, Music2, Trash2, TriangleAlert } from "lucide-react";
import { memo } from "react";
import type { Track } from "@/db/types";
import { cn, formatDuration } from "@/lib/utils";

interface TrackRowProps {
  track: Track;
  index: number;
  isCurrent: boolean;
  onPlay: () => void;
  onToggleLike: () => void;
  onDelete: () => void;
}

function StatusBadge({ status }: { status: Track["status"] }) {
  if (status === "ready") return <Music2 className="size-4 text-muted-foreground" />;
  if (status === "failed") return <TriangleAlert className="size-4 text-destructive" />;
  return <Loader2 className="size-4 animate-spin text-primary" />;
}

export const TrackRow = memo(function TrackRow({
  track,
  index,
  isCurrent,
  onPlay,
  onToggleLike,
  onDelete,
}: TrackRowProps) {
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
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-xs tabular-nums text-muted-foreground">
          {track.status === "ready" ? index + 1 : <StatusBadge status={track.status} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm font-medium", isCurrent && "text-primary")}>
            {track.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {track.status === "failed" ? (track.error ?? "Generation failed") : track.brief.caption}
          </div>
        </div>
      </button>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {track.status === "ready" ? formatDuration(track.durationSec) : "—"}
      </span>
      <button
        type="button"
        onClick={onToggleLike}
        className="shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Like"
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
        className="shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Delete"
      >
        <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
      </button>
    </div>
  );
});
