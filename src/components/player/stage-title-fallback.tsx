import type { Track } from "@/db/types";
import { trackSubtitle } from "@/lib/track-display";
import { cn } from "@/lib/utils";

export function StageTitleFallback({ dim, track }: { dim?: boolean; track: Track | undefined }) {
  const subtitle = trackSubtitle(track);
  const showSubtitle = subtitle && subtitle !== track?.title;

  return (
    <div
      className={cn(
        "absolute inset-0 grid place-items-center bg-muted p-7 text-center",
        dim && "bg-muted/92",
      )}
    >
      <div className="max-w-[82%] space-y-2">
        <div className="line-clamp-3 text-balance font-semibold text-foreground text-2xl sm:text-3xl">
          {track?.title ?? "MUZERO"}
        </div>
        {showSubtitle && (
          <div className="line-clamp-2 text-balance font-medium text-muted-foreground text-sm sm:text-base">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
