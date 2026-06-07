import type { Tab } from "@/components/nav/dock-nav";
import { NavFab } from "@/components/nav/nav-fab";
import { DockControls } from "@/components/player/dock-controls";
import { NowPlayingSheet } from "@/components/player/now-playing-sheet";
import { PlayerStatusLine } from "@/components/player/player-status-line";
import { ProgressScrubber } from "@/components/player/progress-scrubber";
import { TrackIdentityRow } from "@/components/player/track-identity-row";
import { cn } from "@/lib/utils";

/**
 * The unified bottom player-dock — one rounded container. The player info (cover
 * + title + play, then status + progress) stacks on the left; the whole nav is
 * merged into one collapse/expand FAB pinned to its right (playback · 歌单 · settings).
 */
export function PlayerDock({
  tab,
  onTabChange,
  onOpenNowPlaying,
  hidden = false,
}: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onOpenNowPlaying: () => void;
  /** Fade the dock out (immersive idle). The expanded sheet is unaffected. */
  hidden?: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] transition-opacity duration-500",
          hidden && "pointer-events-none opacity-0",
        )}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-3xl bg-card/80 p-3 shadow-lg backdrop-blur-md">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <TrackIdentityRow onOpen={onOpenNowPlaying} />
            <div className="flex flex-col gap-1 px-1">
              <PlayerStatusLine />
              <ProgressScrubber />
            </div>
          </div>
          <DockControls className="hidden sm:flex" />
          <NavFab value={tab} onChange={onTabChange} />
        </div>
      </div>
      <NowPlayingSheet />
    </>
  );
}
