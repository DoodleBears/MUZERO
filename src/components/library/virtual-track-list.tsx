import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { deleteTrack as deleteTrackRepo, setTrackLiked } from "@/db/repositories";
import type { Track } from "@/db/types";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { TrackRow } from "./track-row";

/**
 * Virtualized track list (TanStack Virtual). An endless set can grow to hundreds
 * of tracks; only the visible rows mount. The active set's queue plays by index;
 * cross-set lists (search/library) pass `onPlay` to play a specific track.
 */
export function VirtualTrackList({
  tracks,
  onPlay,
  emptyHint,
  className,
}: {
  tracks: Track[];
  onPlay?: (track: Track, index: number) => void;
  emptyHint?: string;
  /** Extra classes for the scroll element — e.g. `pb-chrome-bottom` to clear the dock. */
  className?: string;
}) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const queue = usePlayerStore((s) => s.queue);
  const playIndex = usePlayerStore((s) => s.playIndex);

  const currentTrackId = currentIndex >= 0 ? queue[currentIndex]?.id : undefined;
  const handlePlay = onPlay ?? ((_track: Track, index: number) => void playIndex(index));

  const rowVirtualizer = useVirtualizer({
    count: tracks.length,
    estimateSize: () => 76,
    getItemKey: (index) => tracks[index]?.id ?? index,
    getScrollElement: () => parentRef.current,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 8,
  });

  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {emptyHint ?? t("track.empty")}
      </div>
    );
  }

  return (
    <div
      className={cn("h-full overflow-y-auto", className)}
      data-testid="virtual-track-list"
      data-virtualized="dynamic-size"
      ref={parentRef}
    >
      <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const track = tracks[virtualRow.index];
          return (
            <div
              className="absolute left-0 top-0 w-full"
              data-index={virtualRow.index}
              data-testid={`virtual-track-row-${track.id}`}
              key={track.id}
              ref={rowVirtualizer.measureElement}
              style={{
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TrackRow
                track={track}
                isCurrent={track.id === currentTrackId}
                onPlay={() => handlePlay(track, virtualRow.index)}
                onToggleLike={() => void setTrackLiked(track.id, !track.liked)}
                onDelete={() => void deleteTrackRepo(track.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
