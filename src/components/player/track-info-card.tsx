import type { ReactNode } from "react";
import type { Track } from "@/db/types";
import { trackSubtitle } from "@/lib/track-display";

/**
 * Poweramp-style info row shown directly below the stage: title/subtitle first,
 * then compact musical chips. The like action lives in the player dock beside
 * play/pause, keeping this area light instead of card-like.
 */
export function TrackInfoCard({ track }: { track: Track }) {
  const hasChips = !!track.brief?.bpm || !!track.brief?.keyscale || !!track.brief;

  return (
    <div className="-mt-1 mx-auto flex w-full flex-col gap-2 ">
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <div className="max-w-full rounded-full border border-white/10 bg-black/35 px-4 py-1.5 shadow-lg backdrop-blur-md">
          <div className="truncate text-2xl font-bold tracking-normal text-white sm:text-2xl">
            {track.title}
          </div>
        </div>
        <div className="max-w-full rounded-full border border-white/10 bg-black/30 px-3 py-1 shadow-md backdrop-blur-md">
          <div className="truncate text-base font-semibold text-white/85">
            {trackSubtitle(track)}
          </div>
        </div>
      </div>

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
