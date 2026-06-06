import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { deleteTrack as deleteTrackRepo, setTrackLiked } from "@/db/repositories";
import type { Track } from "@/db/types";
import { usePlayerStore } from "@/stores/player-store";
import { TrackRow } from "./track-row";

/**
 * Virtualized track list (TanStack Virtual). An endless DJ set can grow to
 * hundreds of tracks; only the visible rows mount. Used for both the live queue
 * and the library.
 */
export function VirtualTrackList({ tracks }: { tracks: Track[] }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const queueIds = usePlayerStore((s) => s.queue);
  const playIndex = usePlayerStore((s) => s.playIndex);

  const currentTrackId = currentIndex >= 0 ? queueIds[currentIndex]?.id : undefined;

  const rowVirtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Nothing here yet — start a set and the DJ will fill it.
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const track = tracks[virtualRow.index];
          return (
            <div
              key={track.id}
              className="absolute left-0 top-0 w-full"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TrackRow
                track={track}
                index={virtualRow.index}
                isCurrent={track.id === currentTrackId}
                onPlay={() => void playIndex(virtualRow.index)}
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
