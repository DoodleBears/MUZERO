import type { R2Presence } from "@/sync/r2-presence";

export interface ListeningNowListProps {
  ariaLabel: string;
  presenceRows: R2Presence[];
  trackTitleById?: ReadonlyMap<string, string>;
}

export function ListeningNowList({
  ariaLabel,
  presenceRows,
  trackTitleById,
}: ListeningNowListProps) {
  if (presenceRows.length === 0) return null;

  return (
    <ul aria-label={ariaLabel} className="grid gap-2">
      {presenceRows.map((presence) => {
        const trackLabel =
          (presence.trackId ? trackTitleById?.get(presence.trackId) : undefined) ??
          presence.trackId;
        return (
          <li
            key={presence.devicePublicId}
            className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/25 px-2.5 py-2"
          >
            <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-sm">
                {presence.deviceName ?? presence.devicePublicId}
              </span>
              {trackLabel && (
                <span className="block truncate text-muted-foreground text-xs">{trackLabel}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
