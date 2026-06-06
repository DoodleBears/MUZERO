import type { Tab } from "@/components/nav/dock-nav";
import { NavRow } from "@/components/nav/nav-row";
import { PlayerStatusLine } from "@/components/player/player-status-line";
import { ProgressScrubber } from "@/components/player/progress-scrubber";
import { TrackIdentityRow } from "@/components/player/track-identity-row";

/**
 * The unified bottom player-dock — one rounded container with three rows
 * (identity + play · progress + status · navigation), replacing the old separate
 * PlayerBar + floating DockNav. Player-first, Poweramp-style: row 3 is a flat,
 * evenly-spaced nav row integrated into the card.
 */
export function PlayerDock({
  tab,
  onTabChange,
  onOpenNowPlaying,
}: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onOpenNowPlaying: () => void;
}) {
  return (
    <div className="shrink-0 px-3 pb-3">
      <div className="mx-auto flex max-w-2xl flex-col gap-2.5 rounded-3xl border border-border bg-card/80 p-3 shadow-lg backdrop-blur-md">
        <TrackIdentityRow onOpen={onOpenNowPlaying} />
        <div className="flex flex-col gap-1 px-1">
          <PlayerStatusLine />
          <ProgressScrubber />
        </div>
        <NavRow value={tab} onChange={onTabChange} />
      </div>
    </div>
  );
}
