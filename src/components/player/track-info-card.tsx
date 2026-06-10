import type { ReactNode } from "react";
import type { Track } from "@/db/types";

/**
 * Compact musical metadata shown below the stage. The title/author pills live in
 * the stage itself (they travel with the cover during a swipe); this row carries
 * the BPM/key/provider chips and the DJ note. Renders nothing for plain uploads.
 */
export function TrackInfoCard({ track }: { track: Track }) {
  const hasChips = !!track.brief;
  const hasNote = !!track.brief?.djNote;
  if (!hasChips && !hasNote) return null;

  return (
    <div className="mx-auto flex w-full flex-col gap-2">
      {hasChips && (
        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {track.brief?.bpm && <Chip>{track.brief.bpm} BPM</Chip>}
          {track.brief?.keyscale && <Chip>{track.brief.keyscale}</Chip>}
          {track.brief && <Chip>{track.provider}</Chip>}
        </div>
      )}

      {track.brief?.djNote && (
        <p className="line-clamp-2 text-sm italic text-muted-foreground">“{track.brief.djNote}”</p>
      )}
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-[0.7rem] bg-card/70 px-2.5 py-1">{children}</span>;
}
